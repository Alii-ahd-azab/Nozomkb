import pool from "@/lib/db";

export async function getPosts() {
  const result = await pool.query(`
    SELECT
      posts.id,
      posts.title,
      posts.content,
      COALESCE(MIN(tags.name), '') AS tag
    FROM posts
    LEFT JOIN post_tags
      ON posts.id = post_tags.post_id
    LEFT JOIN tags
      ON post_tags.tag_id = tags.id
    GROUP BY posts.id
    ORDER BY posts.created_at DESC
  `);

  return result.rows;
}