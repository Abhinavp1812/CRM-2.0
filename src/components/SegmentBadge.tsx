import { segmentInfo, segmentOf } from "@/lib/segments";

/** Coloured customer-category tag (Registered only / One-time / Repeat / Frequent) with the paid visit count. */
export default function SegmentBadge({ visits, size = "sm" }: { visits: number; size?: "sm" | "lg" }) {
  const x = segmentInfo(segmentOf(visits));
  const title = x.label + ": " + visits + " paid visit" + (visits === 1 ? "" : "s");
  if (size === "lg") {
    return (
      <span className={"inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border font-semibold " + x.badge} title={title}>
        <span className={"w-2 h-2 rounded-full " + x.dot} />
        {x.label}
        <span className="font-normal opacity-75">
          · {visits === 0 ? "no paid visit yet" : visits + " paid visit" + (visits === 1 ? "" : "s")}
        </span>
      </span>
    );
  }
  return (
    <span className={"inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-full border font-medium " + x.badge} title={title}>
      <span className={"w-1.5 h-1.5 rounded-full " + x.dot} />
      {x.short}
      {visits > 0 && <span className="opacity-70">· {visits}</span>}
    </span>
  );
}
