import { Injectable } from '@nestjs/common';
import { NotificationChannelType } from '../entities/notification-channel-type.enum';
import { NotificationProvider } from './notification-provider.interface';

@Injectable()
export class ProviderRegistryService {
  private readonly map = new Map<
    NotificationChannelType,
    NotificationProvider
  >();

  constructor(providers: NotificationProvider[]) {
    for (const p of providers) {
      this.map.set(p.type, p);
    }
  }

  get(type: NotificationChannelType): NotificationProvider {
    const p = this.map.get(type);
    if (!p) {
      throw new Error(`No provider registered for type: ${type}`);
    }
    return p;
  }
}
