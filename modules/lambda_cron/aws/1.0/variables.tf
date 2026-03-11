variable "instance" {
  type = object({
    kind    = string
    flavor  = string
    version = string
    metadata = object({
      name = string
    })
    spec = any
  })
}

variable "instance_name" {
  type = string
}

variable "environment" {
  type = object({
    name        = string
    unique_name = optional(string, "")
    cloud_tags  = optional(map(string), {})
  })
}

variable "inputs" {
  type = object({
    cloud_account = any
    network_details = any
  })
}
