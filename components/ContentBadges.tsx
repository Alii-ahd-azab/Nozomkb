import {
  STATUS_LABELS,
  type ContentScope,
  type ContentStatus,
} from "@/lib/definitions";

type ContentBadgesProps = {
  kind: "official" | "community";
  status: ContentStatus;
  scope: ContentScope;
  departmentName: string | null;
};

// Display only. Who may SEE the content is decided on the server.
export default function ContentBadges({
  kind,
  status,
  scope,
  departmentName,
}: ContentBadgesProps) {
  return (
    <div className="content-badges">
      <span className={`badge badge-${kind}`}>
        {kind === "official" ? "Official" : "Community"}
      </span>

      <span className={`badge badge-status-${status}`}>
        {STATUS_LABELS[status]}
      </span>

      <span className="badge badge-scope">
        {scope === "company"
          ? "Company-wide"
          : `Department: ${departmentName ?? "Unknown"}`}
      </span>
    </div>
  );
}
