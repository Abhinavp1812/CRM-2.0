"use client";
import { useState } from "react";
import FollowupEditor from "./FollowupEditor";

interface RemarkOption {
  label: string;
  defaultDaysAhead: number | null;
  autoFlagDnc: boolean;
  closesFollowup: boolean;
}

interface Props {
  customerId: string;
  customerName: string | null;
  currentRemark: string | null;
  currentNote: string | null;
  currentFollowupDate: string;
  remarkOptions: RemarkOption[];
}

export default function FollowupEditButton(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center px-2.5 h-8 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 text-xs font-medium transition-colors"
      >
        Update
      </button>
      {open ? (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center px-4"
          onClick={() => setOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
            <FollowupEditor {...props} onClose={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}