import Image from "next/image";
import styles from "./page.module.css";

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
</main>
  );
}
