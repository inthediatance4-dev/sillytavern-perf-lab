# Rejected early context probe

Tool commit d63861c199ff488d756d4f1a521d25a8137c625b; shared Chromium context. The first 12 pairs failed the HTTP confidence-interval criterion; a fixed 24-pair follow-up was declared before collecting it. Both the follow-up and the pooled 36 pairs pass all six intervals (all samples retained here).

Final evidence verification found probe-induced ReferenceErrors: getContext() can read script.js exports before initialization. The setter caught this expected condition but the retry timer did not. Some successful UI/send runs therefore logged `Cannot access 'chat' before initialization`. This entire protocol was rejected after discovering the error; its statistically passing results are not the final acceptance result. The corrected probe handles that exact initialization ReferenceError in the shared hook, and has a regression test.

The pooling script reads every pair from both retained directories and uses the existing paired medianDifference helper without dropping samples.
