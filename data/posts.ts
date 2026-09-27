export type Post = {
  id: number;
  title: string;
  content: string;
  tag: string;
};

export const posts: Post[] = [
  {
    id: 1,
    title: "How to submit a deliverable",
    content:
      "Make sure the file is reviewed and shared with your team leader before the deadline.",
    tag: "Work Process",
  },
  {
    id: 2,
    title: "Useful accounting shortcut",
    content:
      "A quick method for checking recurring totals before submitting monthly reports.",
    tag: "Accounting",
  },
  {
    id: 3,
    title: "Paid sick leave procedure",
    content:
      "Check the approved HR policy and required documents before submitting your request.",
    tag: "HR",
  },
  {
    id: 4,
    title: "Preparing for a client meeting",
    content:
      "Review the latest project updates and prepare the main discussion points in advance.",
    tag: "Projects",
  },
  {
    id: 5,
    title: "VPN troubleshooting tip",
    content:
      "Restart the VPN client and verify your network connection before contacting IT support.",
    tag: "IT",
  },
];