# User review before committing or pushing

- Implement and test changes locally, then make the updated test UI available for the user to review.
- Explain what changed and ask the user to confirm the result in the test UI.
- Wait for explicit approval of the current changes before committing or pushing. Earlier standing permission to commit and push does not override this review requirement.
- Do not treat passing tests, silence, or elapsed time as approval.
- Keep pending changes local while awaiting review. For changes without a UI, present the relevant diff and verification results for approval instead.

This preference was explicitly requested by the user on 2026-10-18.

# Concise interface copy

- Do not add subtext that restates an obvious label or action.
- Reserve explanations for non-obvious behavior, such as preserving a multi-race seed sequence.
- Keep those explanations compact and use a tooltip or an existing row when practical, rather than adding a separate block that consumes space.

This preference was explicitly requested by the user on 2026-10-26.
