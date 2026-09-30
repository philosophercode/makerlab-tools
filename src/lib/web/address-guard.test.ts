// @vitest-environment node
import { isForbiddenAddress } from "./address-guard";

/**
 * The SSRF address rule (gateway spec §3.3, §8). "A research page makes our
 * server fetch http://169.254.169.254/" is on the spec's list of things that
 * would embarrass us in production (§10).
 */

describe("isForbiddenAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.1", "RFC 1918"],
    ["172.16.0.1", "RFC 1918"],
    ["172.31.255.255", "RFC 1918"],
    ["192.168.1.10", "RFC 1918"],
    ["100.64.0.1", "CGNAT"],
    ["100.127.255.255", "CGNAT"],
    ["100.100.100.200", "Alibaba metadata"],
    ["169.254.0.1", "link-local"],
    ["169.254.169.254", "cloud metadata"],
    ["0.0.0.0", "this network"],
    ["0.1.2.3", "this network"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
    ["192.0.0.170", "IETF protocol assignments"],
    ["198.18.0.1", "benchmarking"],
  ])("refuses IPv4 %s (%s)", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["0:0:0:0:0:0:0:1", "loopback, long form"],
    ["fe80::1", "link-local"],
    ["fe80::1%eth0", "link-local with a zone"],
    ["febf::1", "link-local, top of the range"],
    ["fc00::1", "unique-local"],
    ["fd12:3456:789a::1", "unique-local"],
    ["fd00:ec2::254", "AWS metadata"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:7f00:1", "IPv4-mapped loopback, hex"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
    ["::ffff:10.0.0.1", "IPv4-mapped RFC 1918"],
    ["::ffff:192.168.0.1", "IPv4-mapped RFC 1918"],
    ["::127.0.0.1", "IPv4-compatible loopback"],
    ["64:ff9b::a9fe:a9fe", "NAT64 of the metadata address"],
    ["2002:7f00:1::", "6to4 of loopback"],
    ["[::1]", "bracketed, as in a URL"],
  ])("refuses IPv6 %s (%s)", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "169.253.255.255", "2606:4700:4700::1111", "::ffff:93.184.216.34", "2002:5db8:d822::1"])(
    "allows the public address %s",
    (ip) => {
      expect(isForbiddenAddress(ip)).toBe(false);
    }
  );

  it.each(["", "localhost", "example.com", "999.1.1.1", "1.2.3", "::ffff::1", "gggg::1", "1:2:3:4:5:6:7:8:9"])(
    "refuses %j, which is not an IP address",
    (value) => {
      expect(isForbiddenAddress(value)).toBe(true);
    }
  );
});
