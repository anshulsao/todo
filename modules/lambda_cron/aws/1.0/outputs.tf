locals {
  default_attributes = {
    function_name = aws_lambda_function.main.function_name
    function_arn  = aws_lambda_function.main.arn
    role_arn      = aws_iam_role.lambda.arn
  }
}

output "default" {
  value = {
    attributes = local.default_attributes
    interfaces = {}
  }
}
