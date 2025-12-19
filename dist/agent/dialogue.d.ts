export declare const USER_EDITABLE_SPEC_KEYS: readonly ["language", "problem_count", "difficulty_plan", "topic_tags", "problem_style"];
export type UserEditableSpecKey = (typeof USER_EDITABLE_SPEC_KEYS)[number];
export type DialogueRevision = {
    replaces?: UserEditableSpecKey[];
    invalidates?: UserEditableSpecKey[];
};
export type DialogueUpdate = {
    changed: Partial<Record<UserEditableSpecKey, {
        from: unknown;
        to: unknown;
    }>>;
    added: UserEditableSpecKey[];
    removed: UserEditableSpecKey[];
    invalidated: UserEditableSpecKey[];
};
//# sourceMappingURL=dialogue.d.ts.map