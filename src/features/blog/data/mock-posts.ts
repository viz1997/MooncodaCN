export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  author: string;
  date: string;
  image: string;
}

export const mockPosts: BlogPost[] = [
  {
    slug: "mooncoda-blog-system",
    title: "MOONCODA Blog System",
    excerpt:
      "Learn how to create and manage blog content with Fumadocs MDX in MOONCODA. A comprehensive guide to setting up your blog, writing posts, and customizing the appearance of your content.",
    tags: ["MOONCODA", "BLOG", "FUMADOCS", "MDX", "CONTENT-MANAGEMENT"],
    author: "MOONCODA Team",
    date: "7/11/2025",
    image: "/images/blog/blog-system.png",
  },
  {
    slug: "mooncoda-tech-stack",
    title: "MOONCODA Tech Stack",
    excerpt:
      "Learn about the powerful technologies and tools that make MOONCODA a cutting-edge SaaS starter kit. From Next.js 16 to Drizzle ORM, discover how each piece fits together.",
    tags: ["MOONCODA", "TECH-STACK", "SAAS", "NEXTJS"],
    author: "MOONCODA Team",
    date: "7/10/2025",
    image: "/images/blog/tech-stack.png",
  },
  {
    slug: "update-mooncoda-codebase",
    title: "Update the MOONCODA Codebase",
    excerpt:
      "Keep your MOONCODA project up-to-date with the latest features and security patches. This guide walks you through the process of syncing with upstream changes.",
    tags: ["MOONCODA", "UPDATE", "GIT", "MAINTENANCE"],
    author: "MOONCODA Team",
    date: "7/9/2025",
    image: "/images/blog/update-codebase.png",
  },
  {
    slug: "authentication-with-better-auth",
    title: "Authentication with Better Auth",
    excerpt:
      "Implement secure authentication in your MOONCODA application using Better Auth. Learn about OAuth providers, magic links, and session management.",
    tags: ["AUTH", "SECURITY", "BETTER-AUTH", "OAUTH"],
    author: "MOONCODA Team",
    date: "7/8/2025",
    image: "/images/blog/auth.png",
  },
  {
    slug: "database-with-drizzle-orm",
    title: "Database Setup with Drizzle ORM",
    excerpt:
      "Set up your database with Drizzle ORM for type-safe queries and easy migrations. This guide covers PostgreSQL setup, schema design, and best practices.",
    tags: ["DATABASE", "DRIZZLE", "POSTGRESQL", "ORM"],
    author: "MOONCODA Team",
    date: "7/7/2025",
    image: "/images/blog/database.png",
  },
];
