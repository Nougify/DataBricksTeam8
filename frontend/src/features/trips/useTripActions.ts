"use client";

// Approve / Reject for one proposal (spec §9.3), shared by the overview's approval queue and (M3) the Dispatch tab.
// Buttons disable while either request runs. Success toasts use the action's name ("Trip approved",
// "Proposal rejected"); a 409 shows the spec's copy (the hook has already refetched the trip).
import { toast } from "sonner";
import { isApiError, tripConflictMessage } from "@/lib/api/client";
import { useApproveTrip, useRejectTrip } from "@/lib/api/hooks";
import { toastFailure } from "@/features/topbar/actions";

export function useTripActions(tripId: string) {
  const approve = useApproveTrip();
  const reject = useRejectTrip();
  const pending = approve.isPending || reject.isPending;

  const onError = (action: string) => (err: unknown) => {
    if (isApiError(err) && err.status === 409) toast.warning(tripConflictMessage(err));
    else toastFailure(action, err);
  };

  return {
    pending,
    approving: approve.isPending,
    rejecting: reject.isPending,
    approve: () =>
      approve.mutate({ tripId }, { onSuccess: () => toast.success("Trip approved"), onError: onError("approve the trip") }),
    reject: () =>
      reject.mutate({ tripId }, { onSuccess: () => toast("Proposal rejected"), onError: onError("reject the proposal") }),
  };
}
