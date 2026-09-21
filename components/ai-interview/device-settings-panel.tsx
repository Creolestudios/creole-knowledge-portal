'use client';

import { useEffect, useState } from 'react';
import { X, Camera, Mic, Loader2, AlertCircle } from 'lucide-react';

interface DeviceOption {
  deviceId: string;
  label: string;
}

interface DeviceSettingsPanelProps {
  currentCameraId: string | null;
  currentMicId: string | null;
  onClose: () => void;
  onApply: (selection: { videoDeviceId: string; audioDeviceId: string }) => Promise<void>;
}

/**
 * Zoom/Meet-style "Camera & microphone settings" panel: lists the devices
 * the browser can see (labels only populate once permission has already
 * been granted, which it has by the time this panel is reachable) and lets
 * the candidate switch which camera/mic feeds the interview.
 */
export function DeviceSettingsPanel({ currentCameraId, currentMicId, onClose, onApply }: DeviceSettingsPanelProps) {
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState(currentCameraId ?? '');
  const [selectedMic, setSelectedMic] = useState(currentMicId ?? '');
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        const videoInputs = devices
          .filter((d) => d.kind === 'videoinput')
          .map((d, idx) => ({ deviceId: d.deviceId, label: d.label || `Camera ${idx + 1}` }));
        const audioInputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, idx) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${idx + 1}` }));

        setCameras(videoInputs);
        setMics(audioInputs);
        if (!selectedCamera && videoInputs[0]) setSelectedCamera(videoInputs[0].deviceId);
        if (!selectedMic && audioInputs[0]) setSelectedMic(audioInputs[0].deviceId);
      } catch (err) {
        console.error('[device-settings] failed to list devices:', err);
        setError('Could not list your camera/microphone devices.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only enumerate once on open
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleApply = async () => {
    if (!selectedCamera || !selectedMic) return;
    setApplying(true);
    setError(null);
    try {
      await onApply({ videoDeviceId: selectedCamera, audioDeviceId: selectedMic });
      onClose();
    } catch (err) {
      console.error('[device-settings] failed to apply selection:', err);
      setError('Could not switch to the selected devices. Please try a different camera or microphone.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <button
        id="device-settings-overlay-close"
        type="button"
        aria-label="Close camera and microphone settings"
        tabIndex={-1}
        className="fixed inset-0 z-0 cursor-default"
        onClick={onClose}
      />
      <div
        id="device-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Camera and microphone settings"
        className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-zinc-900">Camera &amp; Microphone Settings</h3>
          <button
            id="device-settings-close"
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="device-settings-camera-select" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                <Camera className="w-3.5 h-3.5" />
                Camera
              </label>
              <select
                id="device-settings-camera-select"
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-100 rounded-xl text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-[#34c4f2]"
              >
                {cameras.length === 0 && <option value="">No camera found</option>}
                {cameras.map((cam) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="device-settings-mic-select" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                <Mic className="w-3.5 h-3.5" />
                Microphone
              </label>
              <select
                id="device-settings-mic-select"
                value={selectedMic}
                onChange={(e) => setSelectedMic(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-50 border border-zinc-100 rounded-xl text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-[#34c4f2]"
              >
                {mics.length === 0 && <option value="">No microphone found</option>}
                {mics.map((mic) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <button
          id="device-settings-apply"
          type="button"
          onClick={handleApply}
          disabled={applying || loading || !selectedCamera || !selectedMic}
          className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-bold py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Apply</span>}
        </button>
      </div>
    </div>
  );
}
