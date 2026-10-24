#!/usr/bin/env bash
# Run the one-off RestoreTask (pg_dump from Supabase, pg_restore into RDS) and print its log.
# Usage: scripts/restore-db.sh staging schema|full|role   (role: only set up the app's qe_app login)
set -euo pipefail
ENV=${1:?usage: restore-db.sh <env> schema|full|role}
MODE=${2:?usage: restore-db.sh <env> schema|full|role}
REGION=${AWS_REGION:-eu-central-1}
out() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "Qe-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
CLUSTER=$(out ClusterName)
# Run the local lib/restore.sh, not the copy baked into the task definition, so a
# script fix takes effect without a stack deploy.
OVERRIDES=$(jq -nc --arg mode "$MODE" --rawfile cmd "$(dirname "$0")/../lib/restore.sh" \
  '{containerOverrides:[{name:"pg",command:[$cmd],environment:[{name:"MODE",value:$mode}]}]}')

TASK=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$(out RestoreTaskDef)" \
  --network-configuration "awsvpcConfiguration={subnets=[$(out PublicSubnets)],securityGroups=[$(out RestoreSg)],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' --output text)
echo "started $TASK ($MODE)"

until [ "$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].lastStatus' --output text)" = STOPPED ]; do sleep 15; done

aws logs tail "$(out RestoreLogGroup)" --region "$REGION" --since 3h --format short | tail -150
CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)
echo "exit code: $CODE"
[ "$CODE" = 0 ]
