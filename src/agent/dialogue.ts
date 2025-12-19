export const USER_EDITABLE_SPEC_KEYS = [
  "language",
  "problem_count",
  "difficulty_plan",
  "topic_tags",
  "problem_style",
] as const;

export type UserEditableSpecKey = (typeof USER_EDITABLE_SPEC_KEYS)[number];

export type DialogueRevision = {
  replaces?: UserEditableSpecKey[];
  invalidates?: UserEditableSpecKey[];
};

export type DialogueUpdate = {
  changed: Partial<Record<UserEditableSpecKey, { from: unknown; to: unknown }>>;
  added: UserEditableSpecKey[];
  removed: UserEditableSpecKey[];
  invalidated: UserEditableSpecKey[];
};

