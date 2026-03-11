locals {
  spec = var.instance.spec

  runtime             = try(local.spec.runtime, "nodejs20.x")
  handler             = try(local.spec.handler, "index.handler")
  memory_size         = try(local.spec.memory_size, 128)
  timeout             = try(local.spec.timeout, 30)
  schedule_expression = try(local.spec.schedule_expression, "cron(0 8 * * ? *)")
  sender_email        = try(local.spec.sender_email, "")
  recipient_email     = try(local.spec.recipient_email, "")
  s3_bucket           = try(local.spec.s3_bucket, "")
  s3_key              = try(local.spec.s3_key, "")
  use_s3              = local.s3_bucket != "" && local.s3_key != ""
  user_env            = try(local.spec.env, {})

  function_name = "${var.instance_name}-${var.environment.unique_name}"

  vpc_id             = var.inputs.network_details.attributes.vpc_id
  private_subnet_ids = var.inputs.network_details.attributes.private_subnet_ids

  all_tags = merge(var.environment.cloud_tags, {
    Name          = var.instance_name
    resource_type = var.instance.kind
  })

  base_env = {
    SENDER_EMAIL    = local.sender_email
    RECIPIENT_EMAIL = local.recipient_email
  }
  lambda_env = merge(local.base_env, local.user_env)
}

# --- IAM Role ---

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = substr(local.function_name, 0, 64)
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = local.all_tags
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "ses_send" {
  statement {
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ses_send" {
  name   = "ses-send"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.ses_send.json
}

# --- Security Group ---

resource "aws_security_group" "lambda" {
  name_prefix = "${local.function_name}-"
  vpc_id      = local.vpc_id
  description = "Security group for ${local.function_name} Lambda"
  tags        = local.all_tags
}

resource "aws_vpc_security_group_egress_rule" "all_outbound" {
  security_group_id = aws_security_group.lambda.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Allow all outbound (RDS, SES, etc.)"
}

# --- Lambda Function ---

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"
  source {
    content  = <<-JS
      exports.handler = async () => {
        console.log("Placeholder — deploy real code via CI");
        return { statusCode: 200, body: "placeholder" };
      };
    JS
    filename = "index.js"
  }
}

resource "aws_lambda_function" "main" {
  function_name = local.function_name
  role          = aws_iam_role.lambda.arn
  handler       = local.handler
  runtime       = local.runtime
  memory_size   = local.memory_size
  timeout       = local.timeout

  # Use S3 when CI has uploaded a zip, otherwise use placeholder for initial deploy
  filename  = local.use_s3 ? null : data.archive_file.placeholder.output_path
  s3_bucket = local.use_s3 ? local.s3_bucket : null
  s3_key    = local.use_s3 ? local.s3_key : null

  vpc_config {
    subnet_ids         = local.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = local.lambda_env
  }

  tags = local.all_tags
}

# --- EventBridge Schedule ---

resource "aws_cloudwatch_event_rule" "schedule" {
  name                = local.function_name
  description         = "Cron trigger for ${local.function_name}"
  schedule_expression = local.schedule_expression
  tags                = local.all_tags
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule = aws_cloudwatch_event_rule.schedule.name
  arn  = aws_lambda_function.main.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.main.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule.arn
}

# --- SES Email Identities ---

resource "aws_ses_email_identity" "sender" {
  count = local.sender_email != "" ? 1 : 0
  email = local.sender_email
}

resource "aws_ses_email_identity" "recipient" {
  count = local.recipient_email != "" ? 1 : 0
  email = local.recipient_email
}
