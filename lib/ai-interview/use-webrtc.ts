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
  const supabase = createClient();

  useEffect(() => {
    if (!interviewId || !isActive) return;

    const channel = supabase.channel(`interview-rtc-${interviewId}`);

    const createPeerConnection = () => {
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      }

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
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
      .on('broadcast', { event: 'webrtc' }, async ({ payload }) => {
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
            }
          }

          if (payload.type === 'ice-candidate') {
            const pc = pcRef.current;
            if (pc) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
          }
        } catch (err) {
          console.error('[WebRTC] Error handling signal:', err);
        }
      })
      .subscribe((status) => {
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
      channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId, isActive, role, supabase]);

  // Update tracks if localStream changes without renegotiation
  useEffect(() => {
    const pc = pcRef.current;
    if (pc && localStream) {
      const senders = pc.getSenders();
      localStream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender && sender.track !== track) {
          sender.replaceTrack(track).catch(console.error);
        }
      });
    }
  }, [localStream]);

  return { remoteStream };
}
