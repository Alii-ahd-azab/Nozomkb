import Image from "next/image";
import styles from "./page.module.css";
import PostCard from "@/components/PostCard";
type Post = {
  id: number;
  title: string;
  content: string;
  tag: string;
};

const posts: Post[] = [
  {
    id: 1,
    title: "How to submit a deliverable",
    content: "Make sure the file is reviewed and shared with your team leader before the deadline.",
    tag: "Work Process",
  },
  {
    id: 2,
    title: "Useful accounting shortcut",
    content: "A quick method for checking recurring totals before submitting monthly reports.",
    tag: "Accounting",
  },
  {
    id: 3,
    title: "Paid sick leave procedure",
    content: "Check the approved HR policy and required documents before submitting your request.",
    tag: "HR",
  },
  {
    id: 4,
    title: "Preparing for a client meeting",
    content: "Review the latest project updates and prepare the main discussion points in advance.",
    tag: "Projects",
  },
  {
    id: 5,
    title: "VPN troubleshooting tip",
    content: "Restart the VPN client and verify your network connection before contacting IT support.",
    tag: "IT",
  },
];



export default function Home() {
  return (
<main>
  <div className="about-card">
    <p className="eyebrow">Internal Knowledge Platform</p>
    <h1>Nozom Knowledge Bank</h1>

    <p>
      An internal platform where Nozom employees can find company knowledge
      and share useful experience.
    </p>

    <div className="features">
  <div>
    <h2>Find knowledge</h2>
    <p>Search company information, policies, and useful employee knowledge.</p>
  </div>

  <div>
    <h2>Share experience</h2>
    <p>Employees can contribute useful posts and practical knowledge.</p>
  </div>
  </div>
  </div>
  
<section className="feed-section">
  <div className="feed-header">
    <p className="eyebrow">Employee Knowledge</p>
    <h2>Knowledge Feed</h2>
  </div>

  <div className="feed-list">
    {posts.map((post) => (
      <PostCard
        key={post.id}
        title={post.title}
        content={post.content}
        tag={post.tag}
      />
    ))}
  </div>
</section>



</main>
  );
}
