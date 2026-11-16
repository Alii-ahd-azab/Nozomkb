// Server Component: Bookmark, Files and Comments for a Post / Official Page.
// Only rendered after the page has already checked canReadParent.
import BookmarkButton from "@/components/BookmarkButton";
import CommentsSection from "@/components/CommentsSection";
import FilesSection from "@/components/FilesSection";
import { canManageFiles, canSeeFile, type ContentParent } from "@/lib/authz";
import { isBookmarked } from "@/lib/bookmarks";
import { listComments } from "@/lib/comments";
import { listFiles, toFileItem } from "@/lib/files";
import { toCommentItem } from "@/lib/handlers/comments";
import type { CurrentUser } from "@/lib/definitions";

type ParentExtrasProps = {
  user: CurrentUser;
  parent: ContentParent & { id: number; title: string };
};

export default async function ParentExtras({ user, parent }: ParentExtrasProps) {
  const [comments, files, bookmarked] = await Promise.all([
    listComments(parent.kind, parent.id),
    listFiles(parent.kind, parent.id),
    isBookmarked(user.id, parent.kind, parent.id),
  ]);

  return (
    <>
      <BookmarkButton
        kind={parent.kind}
        id={parent.id}
        initialBookmarked={bookmarked}
      />

      <FilesSection
        kind={parent.kind}
        parentId={parent.id}
        initialFiles={files
          // disabled Files: managers only (Week 7)
          .filter((file) => canSeeFile(user, parent, file))
          .map(toFileItem)}
        canManage={canManageFiles(user, parent)}
      />

      <CommentsSection
        kind={parent.kind}
        parentId={parent.id}
        initialComments={comments.map((comment) =>
          toCommentItem(user, parent, comment)
        )}
      />
    </>
  );
}
