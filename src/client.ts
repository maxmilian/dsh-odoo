import type { OdooConfig, ResolvedOdooConfig } from './config.js'
import { assertCredentials, resolveConfig } from './config.js'
import { configError, OdooApiError } from './errors.js'
import type { FetchImplementation } from './rpc.js'
import { RpcTransport } from './rpc.js'
import type { ApiResult, JsonObject, JsonValue } from './types.js'

export { resolveConfig }

interface Handshake {
  readonly uid: number
  readonly version: JsonObject
}

/** Read-only JSON-RPC client for the Odoo external API. */
export class OdooClient {
  readonly #config: ResolvedOdooConfig
  readonly #transport: RpcTransport
  #handshake: Promise<Handshake> | undefined

  /** Creates a client from resolved configuration. */
  constructor(config: ResolvedOdooConfig, fetchImplementation: FetchImplementation = fetch) {
    this.#config = config
    this.#transport = new RpcTransport({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      requestTimeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      fetchImplementation,
    })
  }

  /** Returns the Odoo server version and the authenticated user id. */
  async serverInfo(signal?: AbortSignal): Promise<ApiResult<JsonObject>> {
    const handshake = await this.connect(signal)
    const serverVersion = stringOr(handshake.version.server_version, 'unknown')
    return {
      data: {
        serverVersion,
        serverSerie: stringOr(handshake.version.server_serie, 'unknown'),
        protocolVersion: numberOr(handshake.version.protocol_version, 0),
        uid: handshake.uid,
        db: this.#config.db,
        ...(this.#config.companyId === undefined ? {} : { companyId: this.#config.companyId }),
      },
      meta: { odooVersion: serverVersion },
    }
  }

  /** Performs the handshake once per plugin instance, retrying after a failure. */
  protected connect(signal?: AbortSignal): Promise<Handshake> {
    this.#handshake ??= this.performHandshake(signal).catch((error: unknown) => {
      this.#handshake = undefined
      throw error
    })
    return this.#handshake
  }

  /** Calls one model method through execute_kw with the configured context. */
  protected async execute(
    model: string,
    method: string,
    args: readonly JsonValue[],
    kwargs: JsonObject,
    signal?: AbortSignal,
    maxResponseBytesOverride?: number,
  ): Promise<JsonValue> {
    const { uid } = await this.connect(signal)
    return this.#transport.call(
      {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.#config.db,
          uid,
          this.#config.apiKey,
          model,
          method,
          args as JsonValue,
          this.withContext(kwargs),
        ],
      },
      signal,
      maxResponseBytesOverride,
    )
  }

  /** Adds the configured company context to a call. */
  protected withContext(kwargs: JsonObject): JsonObject {
    if (this.#config.companyId === undefined) return kwargs
    return { ...kwargs, context: { allowed_company_ids: [this.#config.companyId] } }
  }

  /** Exposes the resolved configuration to subclasses in this module. */
  protected get config(): ResolvedOdooConfig {
    return this.#config
  }

  async #performHandshakeSteps(signal?: AbortSignal): Promise<Handshake> {
    assertCredentials(this.#config)
    const version = await this.#transport.call(
      { service: 'common', method: 'version', args: [] },
      signal,
    )
    if (!isJsonObject(version)) {
      throw new OdooApiError('Odoo returned an unexpected version payload.', {
        code: 'INVALID_RESPONSE',
      })
    }
    const uid = await this.#transport.call(
      {
        service: 'common',
        method: 'authenticate',
        args: [this.#config.db, this.#config.username, this.#config.apiKey, {}],
      },
      signal,
    )
    if (!Number.isSafeInteger(uid) || (uid as number) < 1) {
      throw new OdooApiError('Odoo rejected the credentials. Check db, username, and apiKey.', {
        code: 'AUTHENTICATION_FAILED',
      })
    }
    return { uid: uid as number, version }
  }

  private async performHandshake(signal?: AbortSignal): Promise<Handshake> {
    const handshake = await this.#performHandshakeSteps(signal)
    await this.#assertCompanyAllowed(handshake.uid, signal)
    return handshake
  }

  async #assertCompanyAllowed(uid: number, signal?: AbortSignal): Promise<void> {
    const companyId = this.#config.companyId
    if (companyId === undefined) return
    const rows = await this.#transport.call(
      {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.#config.db,
          uid,
          this.#config.apiKey,
          'res.users',
          'read',
          [[uid], ['company_ids']],
          {},
        ],
      },
      signal,
    )
    const record = Array.isArray(rows) ? rows[0] : undefined
    const allowed = isJsonObject(record) ? record.company_ids : undefined
    if (!Array.isArray(allowed) || !allowed.includes(companyId)) {
      throw configError(
        'The configured companyId is not among the authenticated user allowed companies.',
      )
    }
  }
}

/** Creates a client using plugin config over environment variables. */
export function createOdooClient(
  config: OdooConfig = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImplementation: FetchImplementation = fetch,
): OdooClient {
  return new OdooClient(resolveConfig(config, env), fetchImplementation)
}

/** Narrows a JSON value to a plain object. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}
