.runtimeEndpoints[]?.name as $name
| select($name | startswith("candidate_" + $environment + "_"))
| select($name != $intended and ($protected | index($name)) == null)
| $name
