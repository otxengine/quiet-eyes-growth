#!/usr/bin/env bash
# Run the one-off RestoreTask (pg_dump from Supabase, pg_restore into RDS) and print its log.
# Usage: scripts/restore-db.sh staging schema|full
set -euo pipefail
ENV=${1:?usage: restore-db.sh <env> schema|full}
MODE=${2:?usage: restore-db.sh <env> schema|full}
REGION=${AWS_REGION:-eu-central-1}
out() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "Qe-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
CLUSTER=$(out ClusterName)

TASK=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$(out RestoreTaskDef)" \
  --network-configuration "awsvpcConfiguration={subnets=[$(out PublicSubnets)],securityGroups=[$(out RestoreSg)],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"pg\",\"environment\":[{\"name\":\"MODE\",\"value\":\"$MODE\"}]}]}" \
  --query 'tasks[0].taskArn' --output text)
echo "started $TASK ($MODE)"

until [ "$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].lastStatus' --output text)" = STOPPED ]; do sleep 15; done

aws logs tail "$(out RestoreLogGroup)" --region "$REGION" --since 3h --format short | tail -150
CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)
echo "exit code: $CODE"
[ "$CODE" = 0 ]
