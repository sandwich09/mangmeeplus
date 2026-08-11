.tasks[0] as $task
| $task.stopCode == "TaskFailedToStart"
  and ($task.stoppedReason // "" | startswith("ResourceInitializationError: unable to pull secrets or registry auth:"))
  and ($task.stoppedReason // "" | contains("connection issue"))
  and ($task.stoppedReason // "" | contains("context deadline exceeded"))
  and ([$task.containers[].exitCode] | length > 0 and all(. == null))
