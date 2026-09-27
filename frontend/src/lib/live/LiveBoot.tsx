"use client";

// Starts the live connection once the app mounts (after the mock layer, in mock mode). Renders nothing.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mocksReady } from "@/lib/api/mockGate";
import { installAutoResume } from "./autoResume";
import { startLiveConnection, type LiveConnection } from "./connection";
import { createTransport } from "./createTransport";

export function LiveBoot(): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    // StrictMode mounts twice: the first run is disposed before the mocks resolve, so only one connection starts.
    let disposed = false;
    let connection: LiveConnection | null = null;
    const stopAutoResume = installAutoResume();
    void mocksReady().then(() => {
      if (!disposed) connection = startLiveConnection({ queryClient, transportFactory: createTransport });
    });
    return () => {
      disposed = true;
      connection?.stop();
      stopAutoResume();
    };
  }, [queryClient]);

  return null;
}
