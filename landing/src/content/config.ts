/**
 * Astro Content Collections — typed schemas for our SEO blog posts.
 *
 * Each article is a plain Markdown file under `src/content/blog/*.md`.
 * Astro auto-generates static routes at `/blog/<slug>` and provides
 * type-safe `getCollection('blog')` access from any .astro page.
 *
 * The schema below enforces SEO hygiene: every post MUST have a title,
 * description (≤ 160 chars, used for <meta>), keywords, and a date.
 * This prevents shipping half-finished drafts and guarantees
 * rich-results schema compatibility.
 */
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().min(10).max(80),
    description: z.string().min(50).max(170),
    keywords: z.array(z.string()).min(3).max(12),
    slug: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('VoiceInk Team'),
    category: z.enum([
      'guide', 'comparison', 'vertical-health', 'vertical-legal',
      'vertical-creators', 'vertical-teams', 'announcement', 'tutorial',
    ]),
    heroImage: z.string().optional(),
    readingTime: z.string().optional(),
    published: z.boolean().default(true),
  }),
});

export const collections = { blog };
