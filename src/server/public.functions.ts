import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { announcements } from '../../db/schema.js'
import type { PublicAnnouncement } from '@/lib/types'
import { safe } from './auth.server'

/** Only public, published, unexpired announcements. No login required. */
export const getPublicAnnouncements = createServerFn({ method: 'GET' }).handler(
  () =>
    safe(async (): Promise<PublicAnnouncement[]> => {
      const now = new Date()
      const rows = await db
        .select({
          id: announcements.id,
          title: announcements.title,
          body: announcements.body,
          important: announcements.important,
          publishedAt: announcements.publishedAt,
        })
        .from(announcements)
        .where(
          and(
            eq(announcements.visibility, 'public'),
            eq(announcements.status, 'published'),
            lte(announcements.publishedAt, now),
            or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
          ),
        )
        .orderBy(desc(announcements.important), desc(announcements.publishedAt))
        .limit(50)
      return rows.map((r) => ({
        ...r,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      }))
    }),
)
