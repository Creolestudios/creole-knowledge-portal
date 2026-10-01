import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useWebRTC(
  interviewId: string,
  localStream: MediaStream | null,
  role: 'admin' | 'candidate',
  isActive: boolean
) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const supabase = createClient();

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!interviewId || !isActive) return;

    const channel = supabase.channel(`interview-rtc-${interviewId}`);

    const drainPendingCandidates = async (pc: RTCPeerConnection) => {
      while (pendingCandidatesRef.current.length > 0) {
        const candidate = pendingCandidatesRef.current.shift();
        if (candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn('[WebRTC] Failed to add buffered ICE candidate:', err);
          }
        }
      }
    };

    const createPeerConnection = () => {
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      const currentLocal = localStreamRef.current || localStream;
      if (currentLocal) {
        currentLocal.getTracks().forEach((track) => pc.addTrack(track, currentLocal));
      }

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        } else {
          setRemoteStream((prev) => {
            const stream = prev ?? new MediaStream();
            if (event.track && !stream.getTracks().includes(event.track)) {
              stream.addTrack(event.track);
            }
            return new MediaStream(stream.getTracks());
          });
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          channel.send({
            type: 'broadcast',
            event: 'webrtc',
            payload: { type: 'ice-candidate', candidate: event.candidate, sender: role },
          });
        }
      };

      pcRef.current = pc;
      return pc;
    };

    channel
      .on('broadcast', { event: 'webrtc' }, async ({ payload }: { payload: any }) => {
        if (payload.sender === role) return;

        try {
          if (payload.type === 'admin-joined' && role === 'candidate') {
            const pc = createPeerConnection();
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            channel.send({
              type: 'broadcast',
              event: 'webrtc',
              payload: { type: 'offer', offer, sender: role },
            });
          }

          if (payload.type === 'candidate-joined' && role === 'admin') {
            channel.send({
              type: 'broadcast',
              event: 'webrtc',
              payload: { type: 'admin-joined', sender: role },
            });
          }

          if (payload.type === 'offer') {
            const pc = createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
            await drainPendingCandidates(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            channel.send({
              type: 'broadcast',
              event: 'webrtc',
              payload: { type: 'answer', answer, sender: role },
            });
          }

          if (payload.type === 'answer') {
            const pc = pcRef.current;
            if (pc && pc.signalingState !== 'stable') {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
              await drainPendingCandidates(pc);
            }
          }

          if (payload.type === 'ice-candidate') {
            const pc = pcRef.current;
            if (pc && pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } else {
              pendingCandidatesRef.current.push(payload.candidate);
            }
          }
        } catch (err) {
          console.error('[WebRTC] Error handling signal:', err);
        }
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'webrtc',
            payload: { type: `${role}-joined`, sender: role },
          });
        }
      });

    return () => {
      pcRef.current?.close();
      pcRef.current = null;
      pendingCandidatesRef.current = [];
      channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId, isActive, role, supabase]);

  // Update tracks if localStream changes or is populated after connection creation
  useEffect(() => {
    const pc = pcRef.current;
    if (pc && localStream) {
      const senders = pc.getSenders();
      localStream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          if (sender.track !== track) {
            sender.replaceTrack(track).catch(console.error);
          }
        } else {
          try {
            pc.addTrack(track, localStream);
          } catch (err) {
            console.warn('[WebRTC] Failed to add track dynamically:', err);
          }
        }
      });
    }
  }, [localStream]);

  return { remoteStream };
}
