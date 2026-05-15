import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { encryptPrivateKey, decryptPrivateKey } from '../../remote-servers/ssh-key-crypto';
import { verifySignedEnterpriseLicenseToken } from './enterprise-license-token';
import { InstanceEnterpriseLicense } from './instance-enterprise-license.entity';

/** Singleton primary key for {@link InstanceEnterpriseLicense}. */
const INSTANCE_LICENSE_ROW_ID = 1;

/** Default marketing / contact URL when `WEEHAWK_ENTERPRISE_SALES_URL` is unset. */
export const WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT = 'https://weehawk.io';

/**
 * Gates enterprise-only features (audit log UI, granular permissions API).
 *
 * Licensed when `WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY` is set and either `WEEHAWK_ENTERPRISE_LICENSE_KEY`
 * or the database-stored key is a valid Ed25519-signed token (`whl1...`, see `generate-enterprise-license`).
 * Without a configured public key, no license string is accepted (opaque keys are not supported).
 */
@Injectable()
export class EnterpriseLicenseService implements OnModuleInit {
  /** Plaintext key from DB (memory only); never sent to clients. */
  private dbPlainKey = '';

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(InstanceEnterpriseLicense)
    private readonly licenseRows: Repository<InstanceEnterpriseLicense>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.hydrateFromDatabase();
  }

  private encryptionSecretOrEmpty(): string {
    return (this.config.get<string>('WEEHAWK_ENCRYPTION_KEY') ?? '').trim();
  }

  async hydrateFromDatabase(): Promise<void> {
    this.dbPlainKey = '';
    const row = await this.licenseRows.findOne({
      where: { id: INSTANCE_LICENSE_ROW_ID },
    });
    const enc = row?.licenseKeyEncrypted?.trim();
    if (!enc) return;
    const secret = this.encryptionSecretOrEmpty();
    if (!secret) return;
    try {
      this.dbPlainKey = decryptPrivateKey(enc, secret);
    } catch {
      this.dbPlainKey = '';
    }
  }

  hasDatabaseLicenseKey(): boolean {
    return this.dbPlainKey.trim().length >= 8;
  }

  /** When true, the API is configured to verify vendor-signed `whl1...` license tokens. */
  signedLicenseEnforced(): boolean {
    return (this.config.get<string>('WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY') ?? '').trim().length > 0;
  }

  private enterprisePublicKeyPem(): string {
    return (this.config.get<string>('WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY') ?? '').trim();
  }

  /** Whether a single stored/env key string unlocks enterprise features. */
  private keyGrantsEnterprise(plain: string): boolean {
    const trimmed = plain.trim();
    if (!trimmed) return false;
    const pub = this.enterprisePublicKeyPem();
    if (!pub) return false;
    return verifySignedEnterpriseLicenseToken(trimmed, pub) != null;
  }

  isLicensed(): boolean {
    const envKey = (this.config.get<string>('WEEHAWK_ENTERPRISE_LICENSE_KEY') ?? '').trim();
    if (this.keyGrantsEnterprise(envKey)) return true;
    return this.keyGrantsEnterprise(this.dbPlainKey);
  }

  getSalesUrl(): string {
    const raw = (this.config.get<string>('WEEHAWK_ENTERPRISE_SALES_URL') ?? '').trim();
    if (raw.length > 0) {
      try {
        const u = new URL(raw);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          return u.toString().replace(/\/$/, '') || WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT;
        }
      } catch {
        /* fall through */
      }
    }
    return WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT;
  }

  /**
   * Persist or clear the instance license key. Empty / whitespace clears DB storage.
   * Requires `WEEHAWK_ENCRYPTION_KEY` when saving a non-empty key.
   */
  async setInstanceLicenseKey(raw: string): Promise<void> {
    const trimmed = String(raw ?? '').trim();
    const pub = this.enterprisePublicKeyPem();
    if (trimmed.length === 0) {
      await this.licenseRows.delete({ id: INSTANCE_LICENSE_ROW_ID });
      this.dbPlainKey = '';
      return;
    }
    if (!pub) {
      throw new BadRequestException(
        'WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY must be set on the API before an enterprise license key can be stored. Arbitrary strings are not accepted.',
      );
    }
    if (!verifySignedEnterpriseLicenseToken(trimmed, pub)) {
      throw new BadRequestException(
        'Invalid enterprise license token. Paste a vendor-signed key (whl1...) that matches WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY.',
      );
    }
    const secret = this.encryptionSecretOrEmpty();
    if (!secret) {
      throw new BadRequestException(
        'WEEHAWK_ENCRYPTION_KEY is required to store an enterprise license key in the database.',
      );
    }
    const ciphertext = encryptPrivateKey(trimmed, secret);
    await this.licenseRows.save(
      this.licenseRows.create({
        id: INSTANCE_LICENSE_ROW_ID,
        licenseKeyEncrypted: ciphertext,
      }),
    );
    this.dbPlainKey = trimmed;
  }
}
