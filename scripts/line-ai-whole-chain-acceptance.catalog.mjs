/**
 * Executable source-of-truth for the mandatory replay matrix in the Production parity spec.
 *
 * Assertions are semantic on purpose: response wording may vary, but tool reach, mutation reach,
 * terminal outcome and delivery ownership may not. Raw customer image paths or extracted image
 * facts do not belong here; controlled image replays bind those at run time by source SHA-256.
 */
export const LINE_AI_WHOLE_CHAIN_SCENARIOS = [
  {
    id: 'royal-pizza-printed-receipt',
    fixture: 'controlled_external_image',
    assertions: {
      outcome: 'reviewable_receipt_with_grounded_printed_candidates_and_reviewable_unknowns',
      tool: 'ocr_then_permission_checked_expense_read',
      mutation: 'exactly_one_reviewable_draft_no_final_mutation',
      delivery: 'capture_summary_then_grounded_follow_up_after_confirmed_delivery',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts', 'splits every printed item row into its own draft line'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'answers a receipt follow-up from the current captured expense without invoking the model or inventing purpose/tax policy'],
    ],
  },
  {
    id: 'handwritten-cash-bill',
    fixture: 'controlled_external_image',
    assertions: {
      outcome: 'stored_media_with_source_backed_candidates_or_explicit_uncertainty',
      tool: 'ocr_then_api_owned_capture_gate',
      mutation: 'at_most_one_reviewable_draft_no_detached_text_note_no_final_mutation',
      delivery: 'one_capture_or_clarification_outcome_after_storage_result',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts', 'verifies Thai number words on handwritten bills via the shared normalizer'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'router unavailable still captures an uncaptioned receipt that passes the OCR expense gate'],
    ],
  },
  {
    id: 'handwritten-multi-entry-ledger',
    fixture: 'controlled_external_image',
    assertions: {
      outcome: 'stored_multi_entry_media_with_explicit_review_choice',
      tool: 'ocr_classification_then_api_owned_multi_entry_gate',
      mutation: 'zero_single_expense_zero_final_mutation',
      delivery: 'one_three_way_clarification_then_review_handoff',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts', 'stage 2 must forbid collapsing a multi-entry ledger into one expense'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', "name: 'multi-document image'"],
    ],
  },
  {
    id: 'owner-daily-closing-shorthand',
    fixture: 'repository',
    assertions: {
      outcome: 'actionable_daily_close_by_currency_and_control_bucket',
      tool: 'one_permission_checked_expense_daily_closing_snapshot',
      mutation: 'zero_mutation',
      delivery: 'deterministic_sections_with_read_only_web_handoff',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/agents/line-ai-business-query-regression.spec.ts', 'keeps the owner daily-closing shorthand row in the mandatory corpus'],
    ],
  },
  {
    id: 'ambiguous-urgency-after-image',
    fixture: 'repository',
    assertions: {
      outcome: 'clarification_or_safe_noop',
      tool: 'normal_read_route_only_if_independently_classified',
      mutation: 'zero_new_draft_zero_final_mutation',
      delivery: 'pending_media_remains_unconsumed_until_confirmed_delivery',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'an ambiguous follow-up leaves the row PENDING and routes the reply normally'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'keeps a receipt choice pending when the capture outcome cannot be delivered'],
    ],
  },
  {
    id: 'receipt-choice-plus-substitute-request',
    fixture: 'repository',
    assertions: {
      outcome: 'receipt_choice_resolved_and_substitute_preflight_returned_as_independent_outcomes',
      tool: 'api_owned_capture_and_readiness_only',
      mutation: 'one_capture_at_most_zero_prepared_zero_issued_zero_final_mutation',
      delivery: 'consume_only_delivered_subrequest_outcomes',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'completes choice 1 and returns the web-only substitute outcome in the same delivered turn'],
    ],
  },
  {
    id: 'substitute-request-four-missing-fields',
    fixture: 'repository',
    assertions: {
      outcome: 'all_current_permission_visible_blockers_in_one_response',
      tool: 'single_api_owned_consolidated_preflight',
      mutation: 'zero_prepared_zero_issued_zero_final_mutation',
      delivery: 'one_blocked_or_ready_web_handoff_response',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'returns every knowable blocker together and keeps absent policy as ready OWNER_SELF semantics'],
    ],
  },
  {
    id: 'partial-answers-across-turns',
    fixture: 'repository',
    assertions: {
      outcome: 'accepted_fields_persist_and_remaining_blockers_shrink_on_one_workflow',
      tool: 'typed_continuation_boundary',
      mutation: 'idempotent_draft_prefill_only_zero_prepared_zero_final_mutation',
      delivery: 'each_turn_echoes_accepted_and_remaining_fields',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'accepts several labeled fields in one message, preserves them across a later partial answer, and never creates PREPARED evidence'],
    ],
  },
  {
    id: 'expense-draft-all-items-and-questions',
    fixture: 'repository',
    assertions: {
      outcome: 'every_named_item_is_preserved_and_all_document_and_item_gaps_are_returned_together',
      tool: 'bounded_ai_candidates_then_deterministic_api_validation',
      mutation: 'draft_source_facts_only_zero_review_or_final_mutation',
      delivery: 'full_current_snapshot_and_every_remaining_question_after_each_answer',
    },
    evidence: [
      ['apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts', 'preserves every item and asks every document/item gap together without inventing paper numbers'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'routes text spend note to a persistent draft and returns its complete question snapshot'],
    ],
  },
  {
    id: 'expense-draft-durable-resume-and-cas',
    fixture: 'repository',
    assertions: {
      outcome: 'same_authorized_draft_resumes_after_context_expiry_or_requires_exact_target_selection',
      tool: 'database_backed_continuation_read_independent_of_ai_turn_window',
      mutation: 'one_cas_guarded_answer_and_transactional_audit_zero_final_mutation',
      delivery: 'duplicate_event_does_not_reapply_and_failed_delivery_remains_recoverable',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.spec.ts', 'uses the revision of the loaded continuation snapshot for CAS, not a later detail read'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'resumes from the database after the entire 15-turn AI context has unrelated content'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'a duplicate continuation webhook applies its answer exactly once'],
    ],
  },
  {
    id: 'partial-answer-plus-vat-question',
    fixture: 'repository',
    assertions: {
      outcome: 'field_and_grounded_question_complete_independently_with_resume_capsule',
      tool: 'typed_continuation_plus_permission_checked_grounded_read',
      mutation: 'safe_field_only_zero_tax_or_final_mutation',
      delivery: 'single_response_preserves_both_subrequest_outcomes',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'handles accepted fields and a grounded question as separate outcomes in one message'],
    ],
  },
  {
    id: 'intervening-question-between-answers',
    fixture: 'repository',
    assertions: {
      outcome: 'question_answered_without_consuming_pending_field_then_same_workflow_resumes',
      tool: 'grounded_read_then_typed_continuation',
      mutation: 'zero_slot_write_for_question_then_one_validated_field_write_zero_final_mutation',
      delivery: 'question_answer_and_source_generated_resume_capsule',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'answers an intervening VAT question from current source state and resumes without consuming a field'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'answers an arbitrary intervening question normally, then resumes the same substitute workflow'],
    ],
  },
  {
    id: 'intervening-question-with-pending-media',
    fixture: 'repository',
    assertions: {
      outcome: 'question_answered_then_stored_media_choice_resumes',
      tool: 'governed_read_without_pending_media_prompt_injection',
      mutation: 'zero_single_expense_zero_final_mutation',
      delivery: 'business_answer_then_deterministic_media_resume_capsule',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'answers a business question beside pending media, then deterministically resumes the stored picture choice'],
    ],
  },
  {
    id: 'resume-after-web-edit-or-context-expiry',
    fixture: 'repository',
    assertions: {
      outcome: 'current_scope_revision_and_workflow_are_reloaded_or_selection_is_required',
      tool: 'permission_checked_current_state_read',
      mutation: 'zero_stale_overwrite_zero_cross_workflow_write_zero_final_mutation',
      delivery: 'stale_or_selection_response_never_claims_unsaved_history_survived',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'refuses to overwrite a newer web revision with a plain continuation answer'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'does not send conversation context after a 15-minute inactivity gap'],
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'requires target selection when several open workflows exist'],
    ],
  },
  {
    id: 'valid-receipt-already-exists',
    fixture: 'repository',
    assertions: {
      outcome: 'normal_receipt_review_unless_unavailability_or_material_incompleteness_is_proven',
      tool: 'permission_checked_expense_detail_and_eligibility',
      mutation: 'zero_substitute_prepared_zero_final_mutation',
      delivery: 'normal_review_handoff_without_false_issuance_claim',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', 'routes a valid receipt to normal review unless unavailability/incompleteness is proven'],
    ],
  },
  {
    id: 'text-instead-of-evidence-or-signature',
    fixture: 'repository',
    assertions: {
      outcome: 'evidence_signature_and_approval_blockers_remain',
      tool: 'consolidated_preflight_only',
      mutation: 'zero_evidence_zero_signature_zero_approval_zero_final_mutation',
      delivery: 'one_consolidated_blocker_response',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts', "codes.includes('payment_evidence_required')"],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'text signature intent replies asking for the image without creating anything'],
    ],
  },
  {
    id: 'casual-lottery-exclamation',
    fixture: 'repository',
    assertions: {
      outcome: 'safe_casual_reply',
      tool: 'zero_erp_tools',
      mutation: 'zero_mutation',
      delivery: 'one_bounded_casual_response',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts', 'หวยแตกมาก'],
      ['apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts', 'handles the reported casual and joking-provocation phrases with zero ERP tools'],
    ],
  },
  {
    id: 'safe-joking-provocation',
    fixture: 'repository',
    assertions: {
      outcome: 'safe_non_escalating_casual_reply',
      tool: 'zero_erp_tools',
      mutation: 'zero_mutation',
      delivery: 'one_bounded_casual_response',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts', 'ต่อยกันไหม'],
      ['apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts', 'handles the reported casual and joking-provocation phrases with zero ERP tools'],
    ],
  },
  {
    id: 'capability-then-vague-follow-up',
    fixture: 'repository',
    assertions: {
      outcome: 'capability_help_then_contextual_examples_without_dashboard_read',
      tool: 'zero_tools_for_both_turns',
      mutation: 'zero_mutation',
      delivery: 'second_turn_requires_delivered_capability_marker',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts', 'answers capability help without reading company or dashboard data'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'keeps an immediate vague follow-up attached to the delivered capability answer without another model call'],
    ],
  },
  {
    id: 'companies-command',
    fixture: 'repository',
    assertions: {
      outcome: 'deterministic_permission_filtered_company_list',
      tool: 'no_agentcore_or_model_call',
      mutation: 'zero_business_mutation',
      delivery: 'one_company_control_response',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'lists owner companies through explicit LINE control command without AI Gateway'],
    ],
  },
  {
    id: 'forced-agentcore-timeout',
    fixture: 'repository',
    assertions: {
      outcome: 'typed_temporary_unavailable_with_expected_candidate_identity',
      tool: 'in_flight_http_aborted_no_late_tool_overlap',
      mutation: 'zero_duplicate_or_final_mutation',
      delivery: 'fallback_is_terminal_only_if_confirmed_else_delivery_pending',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts', 'aborts the in-flight HTTP request and carries binding evidence on timeout'],
      ['apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts', 'AgentCore timeout retains the signed expected identity without claiming an actual artifact'],
    ],
  },
  {
    id: 'permission-revoked-between-turns',
    fixture: 'repository',
    assertions: {
      outcome: 'explicit_permission_refusal_without_prior_business_data',
      tool: 'zero_follow_up_tool_invocation',
      mutation: 'stored_business_record_unchanged_zero_final_mutation',
      delivery: 'refusal_ack_only_after_confirmed_line_delivery',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts', 'refuses safely when permission was revoked between turn and follow-up'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'omits assistant reply previews when current permissions no longer cover previous tools'],
    ],
  },
  {
    id: 'same-media-redelivered',
    fixture: 'repository',
    assertions: {
      outcome: 'same_existing_capture_or_pending_media_outcome',
      tool: 'no_second_ocr_or_capture_path',
      mutation: 'one_attachment_one_pending_row_one_draft_at_most_zero_final_mutation',
      delivery: 'one_visible_clarification_or_capture_outcome',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'a redelivered media+question event reuses the row — exactly one clarify reply, one attachment, one PENDING row, one intake turn'],
      ['apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts', 'redelivery with the same LINE message id returns the existing expense without creating another draft'],
    ],
  },
  {
    id: 'agentcore-ecs-source-mismatch',
    fixture: 'repository',
    assertions: {
      outcome: 'candidate_rejected_before_promotion_and_previous_pair_remains_recoverable',
      tool: 'no_runtime_invocation_from_mismatched_candidate',
      mutation: 'zero_release_mutation_before_exact_binding_recheck',
      delivery: 'no_customer_traffic_to_rejected_candidate',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts', 'fails closed when a candidate omits or mismatches its signed runtime identity'],
      ['infra/security/production-deploy-workflow-v2.spec.sh', 'Recover an unsuccessful closed-stage promotion to the exact closed candidate'],
      ['infra/prod-ecs-express/production-serving-mode.spec.sh', 'AGENTCORE_EXPECTED_SOURCE_COMMIT'],
    ],
  },
];

export const LINE_AI_WHOLE_CHAIN_SUITES = [
  {
    id: 'api-behavior',
    cwd: 'apps/api',
    command: '../../node_modules/.bin/tsx',
    args: ['--test',
      'src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts',
      'src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts',
      'src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts',
      'src/modules/line-ai/application/line-message-buffer.service.spec.ts',
      // §8.3 DB-backed neutral intake state: the four zero-write guarantees (outage, stale/expired,
      // cross-user, cross-chat/company). `pnpm test`'s per-package list does not name this file, so
      // this runner is what executes it.
      'src/modules/line-ai/infrastructure/line-intake-state.repository.spec.ts',
      'src/modules/line-ai/domain/logic/line-ai-terminal-outcome.logic.spec.ts',
      'src/modules/line-ai/domain/logic/line-ai-reconciliation.logic.spec.ts',
      'src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts',
      'src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.spec.ts',
      'src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts',
      'src/modules/expenses/domain/logic/expense-source-draft.logic.spec.ts',
      'src/modules/expenses/infrastructure/prisma-expense.repository.line-continuation.spec.ts',
      'src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts',
      'src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.spec.ts',
      // The shared source-branch boundary also protects LINE capture and reimbursement evidence.
      'src/modules/data-model-core/application/services/transaction-branch.spec.ts',
      'src/modules/expenses/infrastructure/prisma-expense.repository.branch.spec.ts',
      'src/modules/reimbursements/application/services/reimbursement-evidence.service.spec.ts',
    ],
  },
  {
    id: 'gateway-behavior',
    cwd: 'apps/ai-gateway',
    command: '../../node_modules/.bin/tsx',
    args: ['--test',
      'src/app.boot.spec.ts',
      'src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts',
      'src/modules/line-ai/agents/intent-router.agent.spec.ts',
      'src/modules/line-ai/agents/line-ai-business-query-regression.spec.ts',
      'src/modules/line-ai/agents/orchestrator.agent.spec.ts',
      'src/modules/line-ai/agents/response-composer.agent.spec.ts',
      'src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts',
      'src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts',
    ],
  },
  ...[
    'infra/uat/agentcore-candidate-policy.spec.sh',
    'infra/prod-ecs-express/production-serving-mode.spec.sh',
    'infra/security/production-promotion-resources.spec.sh',
    'infra/security/production-deploy-workflow-v2.spec.sh',
  ].map((script) => ({ id: script, cwd: '.', command: 'bash', args: [script] })),
];
