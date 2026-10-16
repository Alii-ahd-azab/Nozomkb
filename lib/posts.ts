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

export async function getPostById(id: number) {
  const result = await pool.query(
    `
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
      WHERE posts.id = $1
      GROUP BY posts.id
    `,
    [id]
  );

  return result.rows[0];
}

export async function createPost(
  title: string,
  content: string,
  userId: number,
  tag: string
) {
  const result = await pool.query(
    `
      INSERT INTO posts (
        title,
        content,
        user_id
      )
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [title, content, userId]
  );

  const newPost = result.rows[0];

  const tagResult = await pool.query(
    `
      SELECT id
      FROM tags
      WHERE name = $1
    `,
    [tag]
  );

  if (tagResult.rows[0]) {
    await pool.query(
      `
        INSERT INTO post_tags (
          post_id,
          tag_id
        )
        VALUES ($1, $2)
      `,
      [newPost.id, tagResult.rows[0].id]
    );
  }

  return {
    ...newPost,
    tag,
  };
}