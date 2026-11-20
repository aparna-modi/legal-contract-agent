from eval.evaluate_rag import run_evaluation


def test_offline_rag_and_risk_benchmark_meets_targets():
    report = run_evaluation(offline=True)

    assert report["retrieval"]["recall_at_3"] >= 0.90
    assert report["retrieval"]["mrr"] >= 0.85
    assert report["generation"]["citation_accuracy"] >= 0.90
    assert report["generation"]["faithfulness"] >= 0.95
    assert report["classification_and_risk"]["classification_accuracy"] >= 0.90
    assert report["classification_and_risk"]["risk_flag_precision"] >= 0.85
    assert report["all_targets_passed"] is True
