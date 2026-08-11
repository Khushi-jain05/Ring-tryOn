"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "idle" | "starting" | "ready" | "denied" | "error";

export type CameraDevice = { deviceId: string; label: string };

/**
 * Owns the webcam stream for the try-on stage.
 *
 * Two things here are easy to get wrong and expensive to debug. First, the
 * stream has to be torn down on unmount or the camera light stays on after the
 * user navigates away. Second, `video.play()` rejects if it is called before
 * the element has metadata, so we wait for `loadedmetadata` rather than
 * assuming the stream is immediately playable.
 */
export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<CameraState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setState("idle");
  }, [videoRef]);

  const start = useCallback(
    async (requestedDeviceId?: string) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState("error");
        setError("This browser does not support camera access.");
        return;
      }

      setState("starting");
      setError(null);

      // Release any previous stream first; some browsers refuse a second
      // getUserMedia on the same device while the first track is still live.
      streamRef.current?.getTracks().forEach((track) => track.stop());

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: requestedDeviceId
            ? {
                deviceId: { exact: requestedDeviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              }
            : {
                facingMode: "user",
                // A ring occupies a tiny part of the frame, and the digital zoom
                // crops in further still — so ask for as much sensor detail as
                // the camera will give, and let it fall back on its own.
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
              },
        });

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video.srcObject = stream;
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve) => {
            video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          });
        }
        await video.play();

        setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);
        setState("ready");

        // Labels are only populated once permission has been granted, so this
        // has to run after getUserMedia rather than on mount.
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(
          all
            .filter((d) => d.kind === "videoinput")
            .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })),
        );
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState("denied");
          setError("Camera access was blocked. Allow it in your browser's site settings and try again.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setState("error");
          setError("No camera was found. Connect one and try again.");
        } else if (name === "NotReadableError") {
          setState("error");
          setError("The camera is already in use by another app.");
        } else {
          setState("error");
          setError(err instanceof Error ? err.message : "Could not start the camera.");
        }
      }
    },
    [videoRef],
  );

  useEffect(() => stop, [stop]);

  return { state, error, devices, deviceId, start, stop };
}
