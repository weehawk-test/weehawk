import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Singleton row (`id` = 1) holding the optional enterprise license key ciphertext.
 * Plain key is never stored; use {@link WEEHAWK_ENCRYPTION_KEY} like other app secrets.
 */
@Entity({ name: 'instance_enterprise_license' })
export class InstanceEnterpriseLicense {
  @PrimaryColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'license_key_encrypted', type: 'text', nullable: true })
  licenseKeyEncrypted!: string | null;
}
