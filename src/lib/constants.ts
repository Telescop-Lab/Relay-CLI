import os from 'node:os'
import path from 'node:path'

export const RELAY_HOME = path.join(os.homedir(), '.relay')
export const DEVICE_BINDING_COOKIE_NAME = 'relay_device_binding'
export const RELAY_USER_AGENT = 'relay-cli/0.1.0'
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000
export const RELAY_TOKEN_ENV = 'RELAY_TOKEN'