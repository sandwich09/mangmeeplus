# Production Go-Live — คำสั่งที่ต้องรันบน AWS ตามลำดับ

สร้าง 2026-08-08 | คู่กับ `docs/plans/production-golive-and-support-access-plan.md`

**รันตามลำดับ ห้ามข้าม** แต่ละขั้นจบด้วยคำสั่งยืนยันที่ต้องได้ผลตามที่เขียนไว้
ถ้ายืนยันไม่ผ่าน **หยุด** อย่าไปขั้นถัดไป

ทุกอย่างอยู่ที่ account `311414082667` region `ap-southeast-1`

```sh
export AWS_REGION=ap-southeast-1
export ACCOUNT=311414082667
aws sts get-caller-identity --query Account --output text   # ต้องได้ 311414082667
```

---

## ขั้น 0 — ดูสถานะจริงก่อน (read-only ไม่เปลี่ยนอะไร)

ตัวเลขในแผนอ่านจาก AWS เมื่อ 2026-08-07 ยืนยันใหม่ก่อนลงมือ

```sh
aws rds describe-db-instances --db-instance-identifier watchdog-bms-prod-db \
  --query 'DBInstances[0].{class:DBInstanceClass,storage:StorageType,iops:Iops,multiAZ:MultiAZ,backup:BackupRetentionPeriod,delProt:DeletionProtection,encrypted:StorageEncrypted,iam:IAMDatabaseAuthenticationEnabled,status:DBInstanceStatus}'

aws elasticache describe-replication-groups --query 'ReplicationGroups[].ReplicationGroupId'

aws secretsmanager list-secrets \
  --query 'SecretList[?starts_with(Name,`watchdog-bms/production/`)].Name' --output table

aws sns list-topics --query 'Topics[].TopicArn'
aws kms list-aliases --query 'Aliases[?starts_with(AliasName,`alias/watchdog`)]'
```

คาดว่าจะเห็น: RDS แบบ single-AZ backup 7 · **ไม่มี** replication group · **ไม่มี** SNS topic · **ไม่มี** KMS key
ถ้าต่างจากนี้ ให้บอกก่อนไปต่อ

---

## ขั้น 0.5 — สิทธิ์ IAM (ยืนยันแล้วว่าจำเป็น 2026-08-08)

`watchdog-bedrock-dev` **ไม่มีสิทธิ์ ElastiCache แทบทั้งหมด** — อ่าน replication group ยังไม่ได้เลย
ไม่ใช่แค่สร้างไม่ได้ แปลว่าทั้งการสร้างและ **ขั้นตอน verify ตอนท้ายสคริปต์** จะพังทั้งคู่

```
AccessDenied ... elasticache:DescribeReplicationGroups ... because no identity-based policy allows
AccessDenied ... elasticache:CreateCacheParameterGroup ... because no identity-based policy allows
```

**อ่าน error ให้ออกก่อนแก้** — ข้อความสองแบบนี้ต่างกันคนละเรื่อง:

| ข้อความ | แปลว่า | ทำยังไง |
| --- | --- | --- |
| `no identity-based policy allows` | ยังไม่ได้ให้สิทธิ์ | แนบ policy เพิ่ม **ได้ผลทันที** |
| `with an explicit deny` | มี Deny ตั้งใจใส่ไว้ | **explicit Deny ชนะ Allow เสมอ** แนบ policy ใหม่ไม่ช่วย ต้องแก้ policy เดิมด้วย `create-policy-version --set-as-default` |

`elasticache:DeleteCacheCluster` เป็นแบบที่สอง — **อย่าไปปลด** เป็น guardrail ที่ตั้งใจใส่ไว้
(`cloud-environment-operations.md` §7 ข้อ 4) policy ข้างล่างจึง **ไม่มี action ลบสักตัว**

### ⚠️ "The selected policies exceed this account's quota" (เจอจริง 2026-08-08)

**IAM user หนึ่งคนแนบ managed policy ได้สูงสุด 10 อัน** และ `watchdog-bedrock-dev` เต็มแล้ว
การ **Attach policies directly** จึงล้มตั้งแต่หน้าจอเลือก

ทางออกคือ **inline policy** ซึ่ง **ไม่นับใน quota 10 อันนั้นเลย** (คนละโควตากัน)
และเหมาะกับงานนี้มากกว่าด้วย เพราะเป็นสิทธิ์ชั่วคราวสำหรับ bootstrap ครั้งเดียว —
ผูกกับ user โดยตรง ลบทิ้งง่าย และไม่กลายเป็น managed policy ที่คนอื่นเอาไปแนบที่อื่นทีหลัง

เพดานของ inline policy คือ **2,048 ตัวอักษร (ไม่นับ whitespace)** ไฟล์นี้อยู่ที่ **1,540 ตัว**

### แนบ policy

```sh
sed 's/<ACCOUNT_ID>/311414082667/g' \
  infra/production/bootstrap-principal-policy.template.json
```

copy ผลลัพธ์ไว้ แล้ว login Console ด้วย admin (`watchdog-bedrock-dev` แก้ IAM ตัวเองไม่ได้ —
`iam:List*` ไม่ได้ให้):

1. IAM → Users → **`watchdog-bedrock-dev`** → แท็บ **Permissions**
2. **Add permissions** → **Create inline policy** ← ไม่ใช่ "Attach policies directly"
3. แท็บ **JSON** → วางทับของเดิมทั้งหมด
4. ตั้งชื่อ `watchdog-bms-production-data-bootstrap` → **Create policy**

**ทางเลือก — ใช้ group** ถ้าอยากได้แบบ reusable: สร้าง group, แนบ managed policy กับ group
(group มีโควตา 10 อันของตัวเองแยกจาก user) แล้วใส่ user เข้า group
เปลืองขั้นตอนกว่าแต่ถอดออกง่ายเหมือนกัน

### ลบทิ้งเมื่อเสร็จ

bootstrap เป็นงานครั้งเดียว สิทธิ์ไม่ควรค้าง — หลังผ่านขั้น 1 แล้ว:

```sh
aws iam delete-user-policy --user-name watchdog-bedrock-dev \
  --policy-name watchdog-bms-production-data-bootstrap
```

### ยืนยันว่าใช้ได้แล้ว

```sh
aws elasticache describe-replication-groups --region ap-southeast-1 \
  --query 'ReplicationGroups[].{id:ReplicationGroupId,status:Status}' --output table
```

- ได้ตารางว่าง (ไม่มี AccessDenied) → **ผ่าน ไปขั้น 1 ได้**
- ยัง AccessDenied → policy ยังไม่ผูก หรือมี Deny ที่กว้างกว่าที่คิด ให้ใช้
  **Policy Simulator** ใน Console ตรวจ (CLI ตรวจไม่ได้เพราะ user นี้อ่าน IAM ตัวเองไม่ได้)

> policy นี้ scope ไว้ที่ resource ของ production ตัวที่ระบุชื่อเท่านั้น ให้เฉพาะ create/read/modify
> **ไม่มี delete สักตัว** และล็อก region ไว้ที่ `ap-southeast-1` เจตนาคือ bootstrap ครั้งเดียวจบ
> ไม่ใช่เปิดสิทธิ์ ElastiCache ทั้งบัญชีให้ automation user ถือยาว

### เรื่องที่ตรวจแล้วเมื่อ 2026-08-08 — ไม่ต้องลบอะไร

`describe-cache-clusters` แสดง node ทุกตัวรวมที่เป็นสมาชิก replication group ผลที่ได้มีแค่
`watchdog-bms-uat-redis` **ยืนยันว่าไม่มี production Redis เหลืออยู่** ตรงกับที่ runbook บันทึกว่า
ถูกลบไปเมื่อ 2026-08-07 — `bootstrap-data.sh` **สร้างอย่างเดียว ไม่ต้องลบอะไรก่อน**

---

## ขั้น 1 — Redis + RDS (ปิด blocker B1/B2/B4)

สคริปต์สร้าง Redis ให้ตรงสเปก M-17, ชี้ secret ใหม่ **โดยไม่เปลี่ยน ARN**, แล้วตรวจซ้ำด้วย
เงื่อนไขเดียวกับ `verify-production-security-baseline.sh` ไม่ใช่แค่ดูว่าคำสั่งไม่ error

```sh
cd /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus

CONFIRM_PRODUCTION_COST=CREATE_PRODUCTION_REDIS \
CONFIRM_PRODUCTION_RDS_HARDENING=APPLY \
  bash infra/production/bootstrap-data.sh
```

**ใช้เวลา ~15–25 นาที** (Redis สร้าง ~10 นาที, RDS failover ~5–10 นาที) สคริปต์ `wait` ให้เอง

สิ่งที่จะเกิดขึ้น:

| | |
| --- | --- |
| Redis | `watchdog-bms-prod-redis` สองโหนดคนละ AZ เข้ารหัสครบ มี auth token snapshot 35 วัน `noeviction` |
| Secret | `watchdog-bms/production/redis-url` ถูกชี้ใหม่ด้วย `put-secret-value` — **ARN เดิม** |
| RDS | `db.t4g.small` + `gp3` + Multi-AZ + backup 35 + deletion protection + IAM auth |

> **ถ้ายังไม่อยากแตะ RDS ตอนนี้** ให้ตัด `CONFIRM_PRODUCTION_RDS_HARDENING=APPLY` ออก
> สคริปต์จะทำแค่ Redis แล้วบอกว่า RDS ขาดอะไรบ้าง (ไม่ fail)

ยืนยัน — ทั้งสองบรรทัดต้องขึ้น `PASS`:

```sh
CONFIRM_PRODUCTION_COST=CREATE_PRODUCTION_REDIS bash infra/production/bootstrap-data.sh
# [prod-bootstrap] PASS redis: encrypted, authenticated, failover enabled, 2 nodes, 35-day snapshots
# [prod-bootstrap] PASS rds: encrypted, Multi-AZ, deletion-protected, 35-day backups
```

(รันซ้ำได้ ไม่สร้างซ้ำ ไม่ลบอะไร)

---

## ขั้น 2 — `connection_limit` (มติ D1 — ความเสี่ยงอันดับหนึ่ง)

แก้ค่าใน secret อย่างเดียว **ไม่ต้องแก้โค้ด** `deploy.sh` ฉีดค่านี้เข้า api-web และ workers

```sh
# 1. อ่านค่าปัจจุบัน (จะมี password อยู่ในนั้น — อย่า paste ที่ไหน)
aws secretsmanager get-secret-value \
  --secret-id watchdog-bms/production/database-url \
  --query SecretString --output text
```

```sh
# 2. ต่อท้าย &connection_limit=10 แล้วเขียนกลับ (ARN เดิม)
CURRENT=$(aws secretsmanager get-secret-value \
  --secret-id watchdog-bms/production/database-url --query SecretString --output text)

case "$CURRENT" in
  *connection_limit=*) echo "มีอยู่แล้ว ไม่ต้องแก้" ;;
  *) aws secretsmanager put-secret-value \
       --secret-id watchdog-bms/production/database-url \
       --secret-string "${CURRENT}&connection_limit=10" >/dev/null && echo "อัปเดตแล้ว" ;;
esac
unset CURRENT
```

ยืนยัน (ไม่โชว์ password):

```sh
aws secretsmanager get-secret-value \
  --secret-id watchdog-bms/production/database-url --query SecretString --output text \
  | grep -o 'connection_limit=[0-9]*'
# connection_limit=10
```

---

## ขั้น 3 — KMS key สำหรับ log (M-16)

**จุดที่คนพลาดบ่อยที่สุด:** CloudWatch Logs ใช้ KMS key ได้ก็ต่อเมื่อ **key policy อนุญาต
service principal `logs.ap-southeast-1.amazonaws.com` พร้อม encryption-context condition**
ถ้าลืม `associate-kms-key` จะ error แบบอ่านไม่รู้เรื่อง

```sh
cat > /tmp/watchdog-log-kms-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableRootAccountAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::${ACCOUNT}:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowCloudWatchLogs",
      "Effect": "Allow",
      "Principal": { "Service": "logs.${AWS_REGION}.amazonaws.com" },
      "Action": [
        "kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*",
        "kms:GenerateDataKey*", "kms:Describe*"
      ],
      "Resource": "*",
      "Condition": {
        "ArnLike": {
          "kms:EncryptionContext:aws:logs:arn":
            "arn:aws:logs:${AWS_REGION}:${ACCOUNT}:log-group:*"
        }
      }
    }
  ]
}
EOF

LOG_KMS_KEY_ARN=$(aws kms create-key \
  --description 'WatchDog BMS production log encryption' \
  --policy file:///tmp/watchdog-log-kms-policy.json \
  --query 'KeyMetadata.Arn' --output text)

aws kms create-alias --alias-name alias/watchdog-bms-production-logs \
  --target-key-id "$LOG_KMS_KEY_ARN"

echo "LOG_KMS_KEY_ID=$LOG_KMS_KEY_ARN"
rm -f /tmp/watchdog-log-kms-policy.json
```

> **ต้องใช้ ARN เต็ม ไม่ใช่ alias หรือ key id** — `deploy.sh` ส่งค่านี้เข้า
> `logs associate-kms-key` ซึ่งรับเฉพาะ ARN **เก็บบรรทัด `LOG_KMS_KEY_ID=...` ไว้** ต้องใช้ตอน deploy

---

## ขั้น 4 — SNS topic + อีเมล (M-16, มติ D2)

```sh
SECURITY_ALERT_TOPIC_ARN=$(aws sns create-topic \
  --name watchdog-bms-production-security-alerts \
  --query TopicArn --output text)

aws sns subscribe --topic-arn "$SECURITY_ALERT_TOPIC_ARN" \
  --protocol email --notification-endpoint thawatchai.phuchana@gmail.com

echo "SECURITY_ALERT_TOPIC_ARN=$SECURITY_ALERT_TOPIC_ARN"
```

### ⚠️ ต้องไปกดลิงก์ยืนยันในอีเมลก่อน

AWS ส่งเมล **"AWS Notification - Subscription Confirmation"** จาก `no-reply@sns.amazonaws.com`
**ต้องกด "Confirm subscription"** ไม่งั้นจะไม่ได้รับ alert เลยทั้งที่ทุกอย่างดูตั้งค่าแล้ว
เช็ค spam folder ด้วย

ยืนยันว่ากดแล้วจริง:

```sh
aws sns list-subscriptions-by-topic --topic-arn "$SECURITY_ALERT_TOPIC_ARN" \
  --query 'Subscriptions[].{endpoint:Endpoint,arn:SubscriptionArn}' --output table
```

- `arn` ขึ้นต้นด้วย `arn:aws:sns:...` → **ยืนยันแล้ว ผ่าน**
- `arn` เป็น `PendingConfirmation` → **ยังไม่ได้กด อย่าไปต่อ**

ทดสอบว่าท่อทำงานจริง:

```sh
aws sns publish --topic-arn "$SECURITY_ALERT_TOPIC_ARN" \
  --subject '[TEST] production alert pipe' \
  --message 'ถ้าเห็นข้อความนี้ในอีเมล แปลว่าท่อแจ้งเตือน production ทำงานแล้ว'
```

**ต้องได้รับเมลจริง** ถ้าไม่ได้รับใน 2 นาที ให้เช็ค spam แล้วเช็ค subscription ใหม่

---

## ขั้น 5 — Alarm ที่ต้องมีตั้งแต่วันแรก

`IncomingBytes` คือตัวที่ถ้ามีตั้งแต่ต้นเดือน เหตุการณ์ 6 ส.ค. จะจบที่ $7 แทน $179

Monitoring operator ต้องมี policy `infra/production/monitoring-bootstrap-policy.template.json` รุ่นปัจจุบัน
(แทน `<ACCOUNT_ID>` ก่อนใช้): P9-1c เพิ่ม statement สำหรับ `PutMetricFilter`, `DescribeMetricFilters`
และ `DeleteMetricFilter` (rollback) โดยจำกัดไว้ที่ API/AI log groups ของ UAT/Production เท่านั้น.
สิทธิ์รวมของ operator ยังขึ้นกับ policy อื่นที่ผูกอยู่ด้วย; template นี้ไม่ใช่หลักฐานของ effective permissions.
API p95 เป็น runtime context จาก request ที่จบแล้ว ไม่ใช่ SLO; ไม่มี traffic จะแสดงไม่มีข้อมูล ไม่ใช่ 0 ms.

```sh
SECURITY_ALERT_TOPIC_ARN="$SECURITY_ALERT_TOPIC_ARN" \
  bash infra/monitoring/runtime-alarms.sh install production
SECURITY_ALERT_TOPIC_ARN="$SECURITY_ALERT_TOPIC_ARN" \
  bash infra/monitoring/runtime-alarms.sh verify production
```

script สร้าง per-log-group `IncomingBytes` 512 MiB/ชั่วโมง, per-node Redis memory 75%, RDS
free storage 4 GB, free memory 200 MB, connections 150 และ CPU credit 50. `verify` เทียบ contract
ทุก field, ยืนยัน SNS subscription และบังคับว่าทุก dimension ต้องมี datapoint จริง นอกจากนี้ `install`
สร้าง dashboard global ชื่อ `watchdog-bms-prod-customer-journeys` และ `verify` อ่าน body กลับมาเทียบ
กับ source ทุก field; ห้ามแก้ dashboard นี้จาก console เพราะรอบ install ถัดไปจะเขียนทับ

**P9-1c activation evidence แยกจาก config verify:** หลัง install ให้เปิดหน้า read-only ตามปกติ
แล้วเก็บ `SampleCount > 0` และ `p95` ของ `WatchDog/Runtime/watchdog_bms_prod_api_response_latency_ms`
ใน region `ap-southeast-1`/ช่วงเวลา UTC หลัง install ที่ระบุชัดเจน พร้อม request log `msg=request`
ที่มี `durationMs` เป็นตัวเลข. ห้ามนับกราฟว่างว่าผ่าน และห้ามยิง financial mutation ซ้ำเพื่อสร้าง telemetry.
ทำ UAT ด้วย metric prefix `watchdog_bms_uat` ก่อน Production ตาม deployment protocol;
fake-AWS/local test ไม่แทนหลักฐานนี้. หากต้อง rollback ให้ลบเฉพาะ filter `api-response-latency`
ใน API log group ของ environment ที่ตรวจ account/region แล้ว และติดตั้ง dashboard จาก revision ก่อน P9-1c;
ข้อมูล metric เดิมหมดอายุตาม retention ของ CloudWatch ไม่ได้ถูกลบตาม filter.

```sh
# หลัง verify per-node ผ่านเท่านั้น ลบ alarm เก่าที่ใช้ ReplicationGroupId และไม่มี datapoint
CONFIRM_RETIRE_INVALID_PROD_REDIS_ALARM=DELETE_ZERO_DATAPOINT_ALARM \
SECURITY_ALERT_TOPIC_ARN="$SECURITY_ALERT_TOPIC_ARN" \
  bash infra/monitoring/runtime-alarms.sh retire-invalid-prod-redis production
```

**ห้ามใช้ `ReplicationGroupId` กับ `DatabaseMemoryUsagePercentage`:** alarm เดิมอยู่ `OK` เพราะ
missing data เป็น non-breaching ทั้งที่ 24 ชั่วโมงมี 0 datapoints. Metric จริงใช้
`CacheClusterId` + `CacheNodeId`; script discover node และสร้าง alarm แยก node. เช่นเดียวกัน
`IncomingBytes` ต้องมี `LogGroupName`; alarm รวมที่ไม่มี dimension ไม่ใช่ control ที่ทำงาน

alarm สร้างล่วงหน้าได้โดยที่ log group ยังไม่มี — จะอยู่ `INSUFFICIENT_DATA` จนกว่าจะมีข้อมูลจริง

> **ข้อจำกัดที่ต้องจำ:** วิธีนี้ไม่ครอบ log group ใหม่โดยอัตโนมัติ
> **เพิ่ม service ที่ 4 เมื่อไหร่ ต้องมาเพิ่ม alarm เอง** ไม่งั้นจะมีจุดบอดเงียบ ๆ
> ถ้าอยากได้ตาข่ายกันพลาดแบบครอบทั้งบัญชี ให้เพิ่ม AWS Budgets + Cost Anomaly Detection
> ซึ่งช้ากว่า (ข้อมูลบิลหน่วง ~24 ชม.) แต่ไม่มีวันมีจุดบอด

ยืนยัน:

```sh
aws cloudwatch describe-alarms --alarm-name-prefix watchdog-bms-prod- \
  --query 'MetricAlarms[].{name:AlarmName,state:StateValue,actions:AlarmActions[0]}' --output table
```

---

## ขั้น 6 — ECR lifecycle policy (กันค่า storage โตไปเรื่อย ๆ)

```sh
cat > /tmp/ecr-lifecycle.json <<'EOF'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep the 20 most recent images; expire the rest",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 20
      },
      "action": { "type": "expire" }
    }
  ]
}
EOF

for repo in watchdog-bms-api watchdog-bms-ai-gateway watchdog-bms-workers watchdog-bms-web; do
  aws ecr put-lifecycle-policy --repository-name "$repo" \
    --lifecycle-policy-text file:///tmp/ecr-lifecycle.json >/dev/null && echo "ok $repo"
done
rm -f /tmp/ecr-lifecycle.json
```

> เก็บ 20 image เพราะ rollback ต้องมี digest เก่าให้กลับไป **อย่าลดต่ำกว่านี้**

---

## ขั้น 7 — Support access (W3)

### 7.1 Bastion

```sh
BASTION=$(aws ec2 describe-instances \
  --filters 'Name=tag:Name,Values=watchdog-bms-ssm-bastion' \
  --query 'Reservations[].Instances[].InstanceId' --output text)
echo "bastion=$BASTION"

aws ec2 start-instances --instance-ids "$BASTION"   # ถ้าดับอยู่ (มติ D6 = เปิดค้าง)
```

**ตรวจว่า SG ไม่มี inbound rule แม้แต่ข้อเดียว** (เงื่อนไขข้อ 1 ของมติ D5):

```sh
BASTION_SG=$(aws ec2 describe-instances --instance-ids "$BASTION" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)

aws ec2 describe-security-groups --group-ids "$BASTION_SG" \
  --query 'SecurityGroups[0].IpPermissions' --output json
# ต้องได้ []  ถ้าไม่ใช่ ให้ลบ rule ออกให้หมด — SSM ไม่ต้องการ inbound เลย
```

บังคับ IMDSv2:

```sh
aws ec2 modify-instance-metadata-options --instance-id "$BASTION" \
  --http-tokens required --http-endpoint enabled
```

### 7.2 ติดตั้งของบน bastion

```sh
aws ssm start-session --target "$BASTION"
```

ในเครื่อง bastion:

```sh
sudo dnf install -y postgresql16 jq
sudo mkdir -p /opt/rds-ca /opt/watchdog
sudo curl -o /opt/rds-ca/global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
psql --version && jq --version
```

แล้ววาง `infra/production/arm-support-execute.sh` ไว้ที่ `/opt/watchdog/` (chmod 0750 เจ้าของ root)

### 7.3 SSM session logging — **ทำก่อนใช้งานจริงครั้งแรก**

session ที่ไม่ถูกบันทึกคือ session ที่ตอบคำถามภายหลังไม่ได้ ตั้งใน Console:
**Systems Manager → Session Manager → Preferences → Edit** → เปิด S3 logging (bucket ที่เข้ารหัส KMS)
และ CloudWatch logging

### 7.4 สร้าง DB role

รันจาก bastion (ต้องมี network ถึง RDS):

```sh
WRITER=$(aws secretsmanager get-secret-value \
  --secret-id watchdog-bms/production/database-url --query SecretString --output text)
PGDATABASE="$WRITER" psql -v ON_ERROR_STOP=1 -f bootstrap-support-roles.sql
unset WRITER
```

ต้องจบด้วย:
```
NOTICE:  support roles verified: ro(login=t, armed_rw=f)
COMMIT
```

**สคริปต์นี้ทดสอบจริงบน PostgreSQL 16 มาแล้ว** (ผลอยู่ในแผน §8) แต่ยังไม่เคยรันบน RDS —
`rds_iam` guard จะทำงานจริงครั้งแรกที่นี่

### 7.5 ซ้อมทั้ง T1 และ T2 บน UAT ก่อน

**ห้ามซ้อมครั้งแรกตอน incident จริง**

---

## ขั้น 8 — Dry-run deploy (W4, ยังไม่มี user)

```sh
gh workflow run deploy-production.yml --ref main \
  -f release_ref=<lowercase-40-char-sha-ที่-reachable-จาก-main> \
  -f target=api-web
```

ต้องส่ง env สองตัวนี้ให้ workflow ไม่งั้น **`deploy.sh` หยุดก่อน rollout**:
- `LOG_KMS_KEY_ID` = ARN จากขั้น 3
- `SECURITY_ALERT_TOPIC_ARN` = ARN จากขั้น 4

ตั้งเป็น GitHub environment variable ของ `production`:

```sh
gh variable set LOG_KMS_KEY_ID --env production --body "$LOG_KMS_KEY_ARN"
gh variable set SECURITY_ALERT_TOPIC_ARN --env production --body "$SECURITY_ALERT_TOPIC_ARN"
```

### ⚠️ ระหว่าง canary bake (3 นาที) ห้าม curl route อื่นนอกจาก `/v1/health`

alarm นับ 4xx/5xx รวม smoke test ของเราเอง — 401/404 จากการ probe จะทำให้ **rollback เงียบ ๆ**

ดูสถานะแบบที่ปลอดภัย:

```sh
aws ecs list-service-deployments --cluster watchdog-bms-prod --service watchdog-bms-api-web-pub
```

หลัง bake จบ ยืนยันด้วย digest จริง ไม่ใช่สถานะ workflow:

```sh
aws ecs describe-express-gateway-service \
  --service arn:aws:ecs:ap-southeast-1:${ACCOUNT}:service/watchdog-bms-prod/watchdog-bms-api-web-pub \
  --query 'activeConfigurations[].primaryContainer.image'
# ต้องมี image เดียว และเป็นตัวใหม่ — ถ้ามีสองตัวแปลว่ากำลัง rollback
```

---

## สรุปสิ่งที่ต้องเก็บไว้

| ตัวแปร | ได้จากขั้น | ใช้ที่ไหน |
| --- | --- | --- |
| `LOG_KMS_KEY_ARN` | 3 | GitHub env `production` |
| `SECURITY_ALERT_TOPIC_ARN` | 4 | GitHub env `production` + alarm ทุกตัว |
| `BASTION` instance id | 7.1 | support path |

## ยังเหลือหลังจากนี้

- [ ] Restore drill (M-17) — ทำใน W4 ตอนยังไม่มี user
- [ ] H-14 network cutover — หมุน `WORKER_INTERNAL_TOKEN` + `AI_GATEWAY_INTERNAL_SECRET` ก่อน launch
      แล้วกำหนดวัน cutover ให้ชัด (ต้องมี NAT หรือ VPC endpoint คืนก่อน)
- [ ] M-01 — launch โดยปิด AI tool ผ่าน feature launch gate แล้วเก็บหลักฐานแล้วค่อยเปิด
- [ ] alarm บน `AuthorizeSecurityGroupIngress` ของ bastion SG (เงื่อนไขข้อ 5 ของมติ D5)
- [ ] Auto-disarm `watchdog_support_rw` ด้วย EventBridge → Lambda
