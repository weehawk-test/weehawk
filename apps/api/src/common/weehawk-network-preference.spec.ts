import {
  externalNetworksWithoutWeehawk,
  mergeWeehawkExternalNetwork,
  parseWeehawkNetworkMode,
} from './weehawk-network-preference';

describe('weehawk-network-preference', () => {
  it('parses explicit header', () => {
    expect(
      parseWeehawkNetworkMode('# network.weehawk: standalone\n'),
    ).toBe('standalone');
    expect(parseWeehawkNetworkMode('# network.weehawk: attach\n')).toBe(
      'attach',
    );
  });

  it('infers attach from legacy app external header', () => {
    expect(
      parseWeehawkNetworkMode(
        '# app.networks.external: weehawk|mydb_net\n',
      ),
    ).toBe('attach');
  });

  it('merges weehawk into external list when attaching', () => {
    expect(mergeWeehawkExternalNetwork(['mydb_net'], true)).toEqual([
      'mydb_net',
      'weehawk',
    ]);
    expect(mergeWeehawkExternalNetwork(['weehawk', 'mydb_net'], false)).toEqual(
      ['mydb_net'],
    );
    expect(externalNetworksWithoutWeehawk(['weehawk', 'a'])).toEqual(['a']);
  });
});
