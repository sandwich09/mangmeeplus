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
    id: 'help-card-memory-follow-up',
    fixture: 'repository',
    assertions: {
      outcome: 'same_eligible_card_offered_after_delivered_answer_and_vague_follow_up',
      tool: 'ids_and_versions_only_with_current_eligibility_rechecked',
      mutation: 'zero_business_mutation',
      delivery: 'confirmed_same_user_company_chat_within_fifteen_minutes_and_fifteen_turns',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'PWS-FOLLOW-STORE paid help stores ids and versions only and a fresh instance returns them as DATA'],
      ['apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts', 'PWS-FOLLOW-OFFER rechecks permissions, features, capabilities, membership and exact versions'],
      ['apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts', 'PWS-FOLLOW-OFFER intake carries remembered ids as per-turn DATA without selecting or changing cached bytes'],
    ],
  },
  {
    id: 'help-card-simpler-follow-up',
    fixture: 'repository',
    assertions: {
      outcome: 'card_answer_then_vague_follow_up_reexplains_the_same_eligible_card',
      tool: 'existing_compose_only_with_card_text_numeric_and_semantic_guards',
      mutation: 'zero_business_mutation',
      delivery: 'card_title_and_grounded_simpler_body_or_verbatim_summary_fallback',
    },
    evidence: [
      ['apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2-grounding.spec.ts', 'PWS-FOLLOW-SIMPLER card answer then ไม่เข้าใจ explains the same card with its title and one existing compose call'],
      ['apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2-grounding.spec.ts', 'PWS-FOLLOW-SIMPLER an out-of-card number or date falls back to the summary as written'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'PWS-FOLLOW-STORE free source-draft shops keep R27 and make zero text-model calls'],
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
      outcome: 'every_named_item_is_preserved_all_gaps_kept_and_only_the_next_required_gap_is_asked',
      tool: 'bounded_ai_candidates_then_deterministic_api_validation',
      mutation: 'draft_source_facts_only_zero_review_or_final_mutation',
      delivery: 'full_current_snapshot_and_every_remaining_question_after_each_answer',
    },
    evidence: [
      ['apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts', 'preserves every item and asks only the next required gap without inventing paper numbers'],
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
  {
    id: 'claim-by-buttons-zero-model',
    fixture: 'repository',
    assertions: {
      outcome: 'sold_workflow_buttons_reach_owned_collection_or_preview',
      tool: 'api_owned_controls_zero_model_calls',
      mutation: 'draft_collection_or_preview_zero_final_mutation',
      delivery: 'owned_choices_and_same_reply_permission_exit',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A3c button and manual line reach receipt category and reason with zero AI reservations'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A4a paid claim picker and signed open bypass credit and models while free shops retain R27'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A4b paid expense and certificate buttons bypass credit and models while free shops retain R27'],
    ],
  },
  {
    id: 'claim-new-line-deterministic',
    fixture: 'repository',
    assertions: {
      outcome: 'manual_amount_description_and_bangkok_date_have_user_text_proofs',
      tool: 'deterministic_user_text_parser_zero_model_calls',
      mutation: 'collection_fields_only_zero_final_mutation',
      delivery: 'one_missing_field_or_source_backed_amount_choices',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts', 'R5 manual claim USER_TEXT proofs:'],
      ['apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts', 'R5 manual claim line asks one missing-field question without choosing among amounts'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A3c exact legacy labels and a selected ambiguous amount use only persisted claim choices'],
    ],
  },
  {
    id: 'credit-out-mid-claim',
    fixture: 'repository',
    assertions: {
      outcome: 'existing_claim_collection_continues_after_credit_exhaustion',
      tool: 'owned_field_answers_zero_model_calls_zero_credit_admission',
      mutation: 'same_draft_action_zero_final_mutation',
      delivery: 'current_receipt_category_reason_and_confirmation_preview',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A3c button and manual line reach receipt category and reason with zero AI reservations'],
    ],
  },
  {
    id: 'next-step-after-ten-minutes',
    fixture: 'repository',
    assertions: {
      outcome: 'signed_next_step_opens_a_fresh_preview_after_thirty_minutes',
      tool: 'api_owned_signed_open_zero_model_calls',
      mutation: 'preview_only_zero_final_mutation',
      delivery: 'payment_intent_and_target_survive_preview_expiry',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A5 partial payment recovery keeps 400 of 1000 after thirty minutes and rejects another owner'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A5 signed payment-next controls preserve payment intent and English control language'],
    ],
  },
  {
    id: 'pending-reason-intervening-question',
    fixture: 'repository',
    assertions: {
      outcome: 'question_preserves_reason_then_ordinary_reason_binds_to_same_card',
      tool: 'pending_field_guard_before_intake',
      mutation: 'zero_field_write_for_question_zero_final_mutation_before_signed_confirm',
      delivery: 'question_keeps_pending_card_and_reason_reopens_confirmation',
    },
    evidence: [
      ['apps/api/src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts', 'Fix-up 17A: void asks one reason and binds the answer to the pending expense card'],
      ['apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts', 'A3b reason fields accept command verbs as ordinary words and reject exact commands'],
    ],
  },
  {
    id: 'pending-payee-intervening-question',
    fixture: 'repository',
    assertions: {
      outcome: 'question_preserves_payee_address_and_numbered_address_resumes',
      tool: 'pending_field_guard_before_intake',
      mutation: 'zero_write_for_question_zero_final_mutation',
      delivery: 'same_card_reappears_with_the_answered_address',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A3b an expense question preserves its pending payee field and a numbered address answers it'],
    ],
  },
  {
    id: 'greeting-bound-chat-zero-model',
    fixture: 'repository',
    assertions: {
      outcome: 'bound_standalone_greeting_returns_before_v2_model_admission',
      tool: 'zero_model_calls_zero_reservations',
      mutation: 'zero_business_mutation',
      delivery: 'one_greeting_response',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A8 bound standalone greeting needs no model or reservation'],
    ],
  },
  {
    id: 'fixed-read-button-zero-model',
    fixture: 'repository',
    assertions: {
      outcome: 'expense_month_uses_server_owned_single_metric_read',
      tool: 'fixed_read_ordinal_zero_zero_model_calls',
      mutation: 'zero_business_mutation',
      delivery: 'prepared_month_answer_or_permission_scoped_free_summary',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'R22 expense month uses only the server fixed-read grant and recovers without a model fallback on paid and free paths'],
      ['apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts', 'shows a complete broad expense summary while preserving source-backed details and counts on request'],
    ],
  },
  {
    id: 'workflow-button-during-support-pause',
    fixture: 'repository',
    assertions: {
      outcome: 'typed_answers_stay_paused_and_explicit_workflow_buttons_remain_available',
      tool: 'owned_control_dispatch_zero_model_calls',
      mutation: 'no_typed_field_mutation_zero_final_mutation',
      delivery: 'support_pause_or_current_control_response_on_paid_and_free_paths',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A3b support contact pauses typed claim answers while workflow buttons remain available on paid and free paths'],
    ],
  },
  {
    id: 'claim-edit-route-unchanged',
    fixture: 'repository',
    assertions: {
      outcome: 'update_selectors_and_guarded_requester_refresh_keep_existing_edit_route',
      tool: 'existing_update_preview_and_requester_lookup',
      mutation: 'zero_financial_write_before_existing_signed_final_mutation_boundary',
      delivery: 'legacy_update_choices_and_current_requester_snapshot',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A3a CREATE selectors are bound postbacks while UPDATE selectors stay byte-identical'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'UPDATE claim previews refresh a legacy login snapshot through the guarded requester lookup'],
    ],
  },
  {
    id: 'partial-payment-next-step-keeps-amount',
    fixture: 'repository',
    assertions: {
      outcome: 'partial_payment_keeps_exact_amount_method_and_date_across_recovery',
      tool: 'signed_payment_intent_and_existing_payment_use_case',
      mutation: 'existing_confirm_then_payment_final_mutations_only_after_their_signed_cards',
      delivery: 'four_hundred_of_one_thousand_never_resets_to_full_balance',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A5 partial payment recovery keeps 400 of 1000 after thirty minutes and rejects another owner'],
      ['apps/api/src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts', 'Fix-up 17A C01: confirm then payment retains'],
    ],
  },
  {
    id: 'invalid-token-vs-expired-card',
    fixture: 'repository',
    assertions: {
      outcome: 'unknown_token_has_menu_exit_and_owned_expiry_has_signed_recovery',
      tool: 'api_owned_token_and_recovery_checks_zero_model_calls',
      mutation: 'zero_final_mutation',
      delivery: 'expired_card_offers_prepare_new_card_without_repairing_bad_tokens',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A5 expired cards offer signed recovery and unknown tokens keep the targetless menu exit'],
    ],
  },
  {
    id: 'buffered-workflow-control-survives',
    fixture: 'repository',
    assertions: {
      outcome: 'pending_and_frozen_controls_keep_company_switch_order',
      tool: 'ordered_worker_dispatch_zero_model_calls',
      mutation: 'zero_business_mutation',
      delivery: 'fixed_read_after_company_switch_uses_the_new_company',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/line-message-buffer.service.spec.ts', 'R23 fresh frozen replay and company switch retain control order'],
    ],
  },
  {
    id: 'fixed-read-unavailable-honest',
    fixture: 'repository',
    assertions: {
      outcome: 'prepared_read_refusal_ends_with_neutral_copy_and_web_exit',
      tool: 'zero_model_calls_zero_fallback_model_calls',
      mutation: 'zero_business_mutation',
      delivery: 'no_model_answer_or_wrong_fallback_copy_after_prepared_refusal',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'R22 expense month uses only the server fixed-read grant and recovers without a model fallback on paid and free paths'],
    ],
  },
  {
    id: 'expired-card-recovery-after-redis-ttl',
    fixture: 'repository',
    assertions: {
      outcome: 'recovery_record_survives_preview_ttl_and_owner_is_rechecked',
      tool: 'owned_recovery_store_and_signed_open_zero_model_calls',
      mutation: 'zero_final_mutation_until_fresh_confirmation',
      delivery: 'fresh_preview_keeps_original_partial_payment_and_cleans_recovery_on_cancel',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A5 recovery records outlive previews for seven days and are removed explicitly'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'A5 partial payment recovery keeps 400 of 1000 after thirty minutes and rejects another owner'],
    ],
  },
  {
    id: 'free-expense-month-summary-zero-model',
    fixture: 'repository',
    assertions: {
      outcome: 'free_member_reads_uploaded_bills_in_the_bangkok_month_and_current_scope',
      tool: 'permission_scoped_expense_list_zero_model_calls_zero_credit_calls',
      mutation: 'zero_business_mutation_zero_ocr_allowance_consumption',
      delivery: 'monthly_summary_then_expense_list_uri_and_main_menu',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'matches every exact alias with optional prefixes, suffixes and spaces without any gateway call'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'uses the Bangkok month, uploadedAt list lens, scoped actor and ordered quick reply URI'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'keeps near misses and members without read permission on the existing refusal'],
    ],
  },
  {
    id: 'stranger-text-before-door-zero-model',
    fixture: 'repository',
    assertions: {
      outcome: 'unlinked_typed_message_gets_one_explanation_before_the_door_card',
      tool: 'zero_model_calls_zero_classifier_calls',
      mutation: 'zero_business_mutation',
      delivery: 'waiting_feedback_settles_before_explanation_then_signup_doors',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'settles waiting feedback before sending the final LINE reply'],
    ],
  },
  {
    id: 'claim-multi-message-accepted-provenance',
    fixture: 'repository',
    assertions: {
      outcome: 'one_claim_preview_with_accepted_amount_date_category_and_reason_across_three_turns',
      tool: 'current_turn_proof_for_new_values_only_zero_model_calls_in_repository_replay',
      mutation: 'collection_and_preview_only_zero_final_mutation',
      delivery: 'confirm_card_or_retry_with_web_exit_without_repeating_accepted_details',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 multi-message claim accepts repeated old proofs and bare accepted values across the exact three turns'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 normalized amount echoes keep accepted money and changed amounts require fresh proof'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 provenance refusal offers the web exit without asking for all accepted claim details again'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 webhook shows the latest provenance refusal instead of the saved missing-field question'],
    ],
  },
  {
    id: 'claim-options-only-turn-preserves-amount',
    fixture: 'repository',
    assertions: {
      outcome: 'reimbursement_draft_saved_with_250_today_travel_reason_and_no_receipt',
      tool: 'get_options_captures_current_turn_values_without_preview_or_model_calls',
      mutation: 'one_signed_draft_save_zero_submit_or_payment_final_mutation',
      delivery: 'confirm_card_then_saved_receipt_after_fourth_user_turn',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 2 exact four turns save a claim when the model only reads options for the amount'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 2 signed webhook saves the four-turn claim with'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 2 get_options preserves the last preview missing fields'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 2 get_options cannot capture pending values from retained earlier-turn evidence'],
    ],
  },
  {
    id: 'typed-claim-submit-one-classifier',
    fixture: 'repository',
    assertions: {
      outcome: 'typed_claim_submit_starts_the_permission_scoped_submit_picker',
      tool: 'zero_text_model_calls_for_lexical_workflow_start',
      mutation: 'zero_final_mutation_before_signed_confirmation',
      delivery: 'same_claim_submit_picker_as_the_workflow_button',
    },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'B4 whole-chain typed claim submit reaches the scoped picker with zero text model calls'],
    ],
  },
  {
    id: 'claim-combined-receipt-category-reason', fixture: 'repository',
    assertions: { outcome: 'reimbursement_draft_saved_after_combined_pending_answer', tool: 'current_turn_fields_without_another_model_call',
      mutation: 'one_final_mutation_draft_save_only_after_signed_confirmation', delivery: 'confirm_card_keeps_amount_date_category_reason_and_missing_receipt' },
    evidence: [['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 3 combined claim answer reaches the confirm card and the fourth press saves the draft']],
  },
  {
    id: 'claim-rejection-amount-selects-permitted-target', fixture: 'repository',
    assertions: { outcome: 'rejection_applies_only_to_the_amount_matched_claim', tool: 'server_matches_current_turn_thb_amount_against_permitted_claims',
      mutation: 'signed_rejection_final_mutation_never_applies_to_the_wrong_model_target', delivery: 'equal_amounts_show_the_existing_claim_picker' },
    evidence: [
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 3 claim amount corrects a wrong model rejection target before reason and signed confirmation'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 3 two permitted claims with the same amount ask with the existing claim picker'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 3 ambiguous claim amount delivers the existing signed picker through the webhook'],
    ],
  },
  {
    id: 'workflow-picker-typed-document-number', fixture: 'repository',
    assertions: { outcome: 'typed_document_number_selects_only_the_delivered_picker_row', tool: 'existing_signed_press_handler_zero_model_calls',
      mutation: 'zero_business_mutation_from_picker_answer', delivery: 'ambiguous_answers_repeat_the_same_picker_with_its_original_expiry' },
    evidence: [['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 4 signed delete picker and typed document number reach the same press handler before capture or intake']],
  },
  {
    id: 'workflow-picker-question-then-typed-row', fixture: 'repository',
    assertions: { outcome: 'a_picker_question_reaches_the_advisor_and_a_later_named_row_continues', tool: 'questions_keep_normal_routing_without_consuming_the_picker',
      mutation: 'zero_final_mutation_before_signed_confirmation', delivery: 'question_answer_then_the_named_claim_preview' },
    evidence: [['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 8 picker questions reach normal routing and a later requester amount still previews c-7']],
  },
  {
    id: 'workflow-picker-off-page-named-bill', fixture: 'repository',
    assertions: { outcome: 'off_page_named_bill_resolves_only_within_the_same_permitted_workflow', tool: 'existing_signed_press_handler_zero_model_calls',
      mutation: 'final_mutation_submits_only_the_named_bill_after_the_signed_confirm_press', delivery: 'ambiguous_matches_show_a_filtered_picker' },
    evidence: [['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 7 off-page named submit bill previews and the signed press applies only that bill'],
      ['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 7 several permitted off-page matches deliver only their filtered picker']],
  },
  {
    id: 'action-preview-delete-by-document-number', fixture: 'repository',
    assertions: { outcome: 'wrong_model_target_is_replaced_with_the_named_permitted_bill', tool: 'server_checks_current_user_evidence_before_preparing_the_action',
      mutation: 'zero_final_mutation_before_signed_confirmation', delivery: 'signed_delete_confirmation_is_bound_to_the_named_bill' },
    evidence: [['apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts', 'M4 round 5 delete by document number reaches the correct signed confirmation through the webhook']],
  },
];

export const LINE_AI_WHOLE_CHAIN_SUITES = [
  { id: 'reliability-gateway-v2', cwd: 'apps/ai-gateway', command: '../../node_modules/.bin/tsx', args: ['--test',
    'src/agentcore/runtime.spec.ts',
    // UAT 2026-09-29: the AgentCore runtime must run the full turn path from a minimal or stale env.
    'src/agentcore/runtime-minimal-env.spec.ts',
    'src/modules/line-ai/agents/approved-knowledge.spec.ts',
    'src/modules/line-ai/agents/line-intake-compact-decision.spec.ts',
    // Owner 2026-10-05 ("ถามวน"): a short reply to the assistant's own question; every decoder rejection reason.
    'src/modules/line-ai/agents/line-intake-reply.spec.ts',
    'src/modules/line-ai/agents/read-tool-input.spec.ts',
    'src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.spec.ts',
    'src/modules/line-ai/application/document-qa.integration.spec.ts',
    'src/modules/line-ai/application/use-cases/line-ai-turn-v2.integration.spec.ts',
      'src/modules/line-ai/agents/semantic-retained-source.spec.ts',
    'src/modules/line-ai/agents/semantic-turn-v2-grounding.spec.ts',
    'src/modules/line-ai/agents/semantic-turn-v2-read-filter-binding.spec.ts',
    'src/modules/line-ai/agents/semantic-turn-v2-terminal-outcomes.spec.ts',
    // tuning-3 item 1: recentReads-based memory grounding for a follow-up its own text never restates.
    'src/modules/line-ai/agents/semantic-turn-v2-memory-filter-grounding.spec.ts',
    // tuning-3 item 3: น้องมั่งมี's persona (ค่ะ, never ครับ/ผม, no English jargon) in compose too.
    'src/modules/line-ai/agents/mangmee-persona.spec.ts',
    'src/modules/line-ai/agents/semantic-turn-v2-persona-sanitize.spec.ts',
    // tuning-3 item 4: grouped two-period comparisons skip compose and rank their own groups.
    'src/modules/line-ai/agents/semantic-turn-v2-compose-skip.spec.ts',
    // Advisor Q1/Q2: "งานค้างของฉัน" also reads the caller's own queues; "วันนี้มีอะไรต้องทำ" never does.
    'src/modules/line-ai/agents/semantic-turn-v2-pending-work.spec.ts',
    'src/modules/line-ai/domain/logic/business-read-result-semantics.spec.ts',
    'src/modules/line-ai/infrastructure/provider/public-lookup.spec.ts',
    'src/modules/line-ai/presentation/http/line-reliability-capabilities.controller.spec.ts',
    // Advisor S3: "ใบเบิกค้างที่ใคร" through router, planner and compose; the shared pile stays its own line.
    'src/modules/line-ai/agents/semantic-turn-v2-approval-backlog.spec.ts',
  ] },
  { id: 'reliability-api-v2', cwd: 'apps/api', command: '../../node_modules/.bin/tsx', args: ['--test',
    // Public Official OA webhook (#999): merged to main without an owning runner, so the API suite's coverage guard failed.
    'src/modules/auth/line-official-webhook.controller.spec.ts',
    'src/modules/billing/application/billing-feature-entitlements.spec.ts',
    'src/modules/billing/application/billing-plan-manage.spec.ts',
    'src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts',
    'src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts',
    'src/modules/employee-access/application/use-cases/update-employee-branch-scope.spec.ts',
    'src/modules/employee-access/application/use-cases/role-management.use-case.spec.ts',
    'src/modules/line-ai/application/line-reimbursement-draft.service.spec.ts',
    'src/modules/line-ai/application/use-cases/erp-banking-tools.use-case.spec.ts',
    // Advisor S2a: billing.get_package_usage (P8 refusal, package figures, pace) and its package-pace-v1 formula.
    'src/modules/line-ai/application/use-cases/erp-package-tools.use-case.spec.ts',
    'src/modules/line-ai/domain/logic/package-usage-pace.logic.spec.ts',
    'src/modules/line-ai/application/use-cases/erp-report-tools.use-case.spec.ts',
    'src/modules/line-ai/application/use-cases/line-public-general.spec.ts',
    'src/modules/line-ai/application/use-cases/process-line-document-qa.bridge.spec.ts',
    'src/modules/line-ai/application/use-cases/process-line-general-v2.spec.ts',
    'src/modules/line-ai/application/use-cases/process-line-mixed-business-v2.spec.ts',
    'src/modules/line-ai/application/use-cases/process-line-task-resume.spec.ts',
    'src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts',
    'src/modules/line-ai/domain/logic/line-preference-command.logic.spec.ts',
    'src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.spec.ts',
    'src/modules/line-ai/infrastructure/public-lookup.spec.ts',
    'src/modules/line-ai/line-ai-capability-manifest.spec.ts',
    'src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts',
    // Advisor S1: the caller's own substitute-receipt signature queue and its LINE read tool.
    'src/modules/expenses/application/use-cases/substitute-receipt-signature-queue.use-case.spec.ts',
    'src/modules/line-ai/application/use-cases/erp-substitute-receipt-tools.use-case.spec.ts',
    'src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.spec.ts',
    'src/modules/reimbursements/presentation/http/reimbursement-draft-action.controller.spec.ts',
    // Advisor S3: whose desk the waiting claims are on (pile vs one approver, departed approvers, branch, scope).
    'src/modules/reimbursements/application/use-cases/reimbursement-approval-backlog.use-case.spec.ts',
    // Free source drafts (049aa51de): merged without an owning runner, so the API suite's coverage guard failed.
    'src/modules/auth/free-expense-handoff.spec.ts',
    'src/modules/auth/free-expense-password-login.spec.ts',
    'src/modules/data-model-core/application/use-cases/free-expense-attachment.spec.ts',
    'src/modules/expenses/application/use-cases/expense-free-access.use-case.spec.ts',
    'src/modules/line-ai/domain/logic/free-expense-line.logic.spec.ts',
    'src/modules/system-partner-management/application/free-expense-access.spec.ts',
  ] },
  { id: 'reliability-web-v2', cwd: 'apps/web', command: '../../node_modules/.bin/tsx', args: ['--test',
    'src/features/reimbursements/ReimbursementDraftActionPage.qa.spec.ts',
  ] },
  { id: 'reliability-contracts-evaluation-v2', cwd: '.', command: 'node_modules/.bin/tsx', args: ['--test',
    'packages/contracts/src/ai-budget-bounds-v2.spec.ts',
    'packages/contracts/src/line-ai-input-evidence.spec.ts',
    'packages/contracts/src/line-ai-public-lookup.spec.ts',
    'packages/contracts/src/line-ai-value-candidates-v2.spec.ts',
    'packages/contracts/src/line-document-qa.spec.ts',
    'packages/contracts/src/line-reimbursement-draft.spec.ts',
    // The claim-line date rule the web form, the API and the LINE claim draft share. The contracts package's own
    // `test` script is a fixed list that does not name this file, so this runner is what executes it.
    'packages/contracts/src/reimbursements.spec.ts',
    'scripts/line-ai-reliability-blind-comparison.spec.ts',
    'scripts/line-ai-reliability-corpus.spec.ts',
    'scripts/line-ai-reliability-evaluation.spec.ts',
    'scripts/line-ai-reliability-fixtures.spec.ts',
    'scripts/line-ai-reliability-runtime.spec.ts',
    'scripts/line-ai-expense-advisor/types.spec.ts',
    'scripts/line-ai-expense-advisor/scorer.spec.ts',
    'scripts/line-ai-expense-advisor/template.spec.ts',
    'scripts/line-ai-expense-advisor/report.spec.ts',
    'scripts/line-ai-expense-advisor/oracle.spec.ts',
    'scripts/line-ai-expense-advisor/run-rescore.spec.ts',
  ] },
  {
    id: 'api-behavior',
    cwd: 'apps/api',
    command: '../../node_modules/.bin/tsx',
    args: ['--test',
      'src/common/security/liff-start-handoff.spec.ts',
      // Sales-event discounts, LINE claim (SD-B): the QR token, ticket serial/expiry and refusal order.
      'src/modules/sales-console/domain/sales-event-claim.logic.spec.ts',
      'src/modules/sales-console/application/claim-event-discount.use-case.spec.ts',
      'src/common/security/liff-event-discount-page.spec.ts',
      'src/modules/billing/application/billing-event-discount.spec.ts',
      // LINE "ฉันมีส่วนลดไหม" (sales-event spec §8.1): the routing words and every answer case.
      'src/modules/line-ai/domain/logic/line-event-discount.logic.spec.ts',
      // Web/LINE signup shares the durable mail consumer; preserve its provider boundary too.
      'src/modules/auth/infrastructure/postmark.client.spec.ts',
      'src/modules/auth/infrastructure/postmark-configuration.spec.ts',
      'src/modules/system-partner-management/application/partner-ai-adjustment-history.spec.ts',
      // Sales console deal rules (Phase 2). Not LINE, but this suite is the repo's runner for
      // specs outside the api fixed list, which package.json may not be edited to extend.
      'src/modules/sales-console/domain/sales-deal.logic.spec.ts',
      // Phase 4 counting formula, anti-gaming flags, renewal windows and digest text.
      'src/modules/sales-console/domain/sales-attribution.logic.spec.ts',
      'src/modules/sales-console/domain/sales-renewal.logic.spec.ts',
      // Sales-event discounts, console (SD-A): batch form, state machine, QR life, ฿10 first-bill floor.
      'src/modules/sales-console/domain/sales-event.logic.spec.ts',
      // Sales-event report: event → batch → เซลล์ counts and the discount given (SD-E18).
      'src/modules/sales-console/domain/sales-event-report.logic.spec.ts',
      // Phase 3 deal offer / snapshot / purchase-mode rules (same reason as above).
      'src/modules/billing/domain/deal-offer.spec.ts',
      'src/modules/billing/application/billing-deal-chat-credit.spec.ts',
      // Phase 5 auto-renewing deals: the return operation's provider write and its definition of
      // done, which nothing else in the suite exercises.
      'src/modules/billing/application/billing-price-return.spec.ts',
      // Phase 7 mid-term package change: which menu set the new tier is entitled to, and the two
      // shops whose menus a package change must not touch.
      'src/modules/billing/application/billing-plan-menus.spec.ts',
      'src/modules/billing/domain/billing-package.spec.ts',
      'src/modules/billing/domain/paid-checkout-invoice.spec.ts',
      'src/modules/billing/infrastructure/stripe.client.spec.ts',
      'src/modules/billing/line-billing-entry.spec.ts',
      'src/modules/billing/application/billing-capacity.spec.ts',
      'src/modules/billing/application/billing-approval.spec.ts',
      // Purchase-without-setup PR A: the one plan-manager predicate LINE and the web share (R-C11).
      'src/modules/access-control/domain/logic/plan-manager.logic.spec.ts',
      // Purchase-without-setup PR C: recipient OTP, document resend and recipient mail/bounce (R-A7/R-A8/R-D1).
      'src/modules/billing/domain/billing-recipient-otp.logic.spec.ts',
      'src/modules/billing/application/billing-recipient-otp.service.spec.ts',
      'src/modules/billing/application/billing-document-resend.spec.ts',
      'src/modules/billing/application/billing-notifications-recipient.spec.ts',
      // Purchase-without-setup PR E: admin document tools (recipient change, resend, lookup, identity).
      'src/modules/billing/application/billing-document-admin.service.spec.ts',
      'src/modules/billing/application/billing-admin-lookup.spec.ts',
      'src/modules/system-partner-management/application/use-cases/update-partner-identity.use-case.spec.ts',
      // Chat credit and receipt image add-ons PR A: the policy parser reads old and new policies (spec §8.4, A37).
      'src/modules/billing/domain/billing-policy-addon.spec.ts',
      // Add-ons PR B: the receipt allocator (package → team → purchased, D4/D8) and the shared grant seam + team grant (§16).
      'src/modules/billing/application/billing-receipt-allocator.spec.ts',
      'src/modules/billing/application/billing-addon-admin-grants.spec.ts',
      // Sales-event discounts SD-C: first-bill amounts per tax treatment, eligibility, ticket choice and stale rules.
      'src/modules/billing/domain/billing-event-discount.logic.spec.ts',
      // Promotion campaigns (plan starter-249-bonus-month-promotion): terms, publication rules and the support matrix.
      'src/modules/billing/domain/billing-promotion.spec.ts',
      // Add-ons PR C: AI credit cycles follow the paid package periods (spec §5.1, T-01, O-01; A06/A34).
      'src/modules/line-ai/application/ai-credit-cycles.spec.ts',
      'src/modules/system-partner-management/domain/logic/plan-capacity.spec.ts',
      'src/modules/billing/application/billing-collection.spec.ts',
      'src/modules/billing/application/billing-free-days.spec.ts',
      'src/modules/billing/application/billing-financial.spec.ts',
      'src/modules/billing/application/billing-refund-source.spec.ts',
      'src/modules/billing/application/billing-end-package.spec.ts',
      'src/modules/billing/application/billing-settlement-source.spec.ts',
      'src/modules/billing/application/billing-checkout-expiry-source.spec.ts',
      'src/modules/billing/application/billing-reconcile-command.spec.ts',
      'src/modules/billing/application/billing-schedule.spec.ts',
      'src/modules/billing/application/billing-upgrade.spec.ts',
      'src/modules/billing/application/billing-restart.spec.ts',
      'src/modules/billing/application/billing-deal-subscription-cancel.spec.ts',
      'src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts',
      'src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts',
      'src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts',
      'src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts',
      'src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts',
      'src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.spec.ts',
      'src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts',
      // §12 money admission for a SPLIT company: the reservation decision table, the execution
      // identities and the two internal budget seams the gateway will call. `pnpm test`'s
      // per-package list does not name either file, so this runner is what executes them.
      'src/modules/line-ai/application/company-ai-budget-reservation.spec.ts',
      'src/modules/line-ai/presentation/http/internal-ai-budget.controller.spec.ts',
      // Hold reconciliation (hold spec §4): the operator boundary for credit nothing will ever
      // release by itself. Not in `apps/api/package.json`'s fixed list, so this runner executes it.
      'src/modules/system-partner-management/application/use-cases/partner-ai-credit-holds.use-case.spec.ts',
      // Phase F: the COMBINED regression — ledger NOGROUP, split denial, receipt persistence,
      // usage, reservations and delivery asserted together on one turn through the real webhook
      // use case. Not in `apps/api/package.json`'s fixed list, so this runner is what executes it.
      'src/modules/line-ai/application/use-cases/line-ai-combined-regression.spec.ts',
      'src/modules/line-ai/application/line-message-buffer.service.spec.ts',
      // §8.3 DB-backed neutral intake state: the four zero-write guarantees (outage, stale/expired,
      // cross-user, cross-chat/company). `pnpm test`'s per-package list does not name this file, so
      // this runner is what executes it.
      'src/modules/line-ai/infrastructure/line-intake-state.repository.spec.ts',
      'src/modules/line-ai/application/line-read-evidence.spec.ts',
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
      // Shared permission, source-evidence and task-state guards also cover captured expenses.
      'src/modules/ai-draft/application/source-state.service.spec.ts',
      'src/modules/expenses/infrastructure/expense-evidence-sources.spec.ts',
      'src/modules/dashboard-notifications/infrastructure/document-notification-state.spec.ts',
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

/** Real PostgreSQL invariants run separately with a mandatory isolated database URL. */
export const LINE_AI_RELIABILITY_POSTGRES_SUITES = [
  { id: 'eval-guard-postgres', cwd: '.', command: 'node', args: ['--import', 'tsx', '--test', '--test-name-pattern', 'real PostgreSQL: eval_guard', 'scripts/line-ai-reliability-runtime.spec.ts'] },
  { id: 'reliability-postgres-v2', cwd: 'apps/api', command: '../../node_modules/.bin/tsx', args: ['--test',
  'src/modules/billing/application/billing-feature-entitlements.pg.spec.ts',
  'src/modules/line-ai/application/line-retained-task-source.pg.spec.ts',
  'src/modules/line-ai/application/line-ai-budget-authority.pg.spec.ts',
  'src/modules/line-ai/application/company-ai-budget-reservation.pg.spec.ts',
  // Add-ons PR C: AI credit funding of LINE v2 holds (spec §5.3, §8.3; A05/A07/A09/A30/A34/A36).
  'src/modules/line-ai/application/ai-credit-funding.pg.spec.ts',
  // Advisor S2a: billing.get_package_usage over real receipt lots, OCR admissions and plan-limit counts.
  'src/modules/line-ai/application/package-usage.pg.spec.ts',
  'src/modules/line-ai/application/line-capture-delivery.pg.spec.ts',
  'src/modules/line-ai/application/line-conversation-context.pg.spec.ts',
  'src/modules/line-ai/application/line-document-qa.pg.spec.ts',
  'src/modules/line-ai/application/line-input-buffer.pg.spec.ts',
  'src/modules/line-ai/application/line-ledger-accepted-request.pg.spec.ts',
  'src/modules/line-ai/application/line-pending-media.pg.spec.ts',
  'src/modules/line-ai/application/line-reimbursement-draft-adapter.pg.spec.ts',
  'src/modules/line-ai/application/use-cases/erp-source-reliability.pg.spec.ts',
  'src/modules/line-ai/line-delivery-plan.pg.spec.ts',
  'src/modules/reimbursements/line-reimbursement-draft.pg.spec.ts',
  // Advisor S1: every signature-queue gate translated to SQL (branch, self-approval, paper, correction).
  'src/modules/expenses/substitute-receipt-signature-queue.pg.spec.ts',
 ] }];
