import { z } from "zod";
import { ActivityLanguageSchema } from "./activitySpec";

export const LearnerPreferredStyleSchema = z.enum(["guided", "exploratory"]);
export type LearnerPreferredStyle = z.infer<typeof LearnerPreferredStyleSchema>;

export const LearnerFailureSchema = z
  .object({
    concept: z.string().trim().min(1).max(64),
    count: z.number().int().min(1).max(10_000),
    last_seen: z.string().datetime(),
  })
  .strict();

export type LearnerFailure = z.infer<typeof LearnerFailureSchema>;

export const LearnerProfileSchema = z
  .object({
    user_id: z.number().int().positive(),
    language: ActivityLanguageSchema,
    concept_mastery: z.record(z.string().trim().min(1).max(64), z.number().min(0).max(1)),
    recent_failures: z.array(LearnerFailureSchema).max(50),
    preferred_style: LearnerPreferredStyleSchema.optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

