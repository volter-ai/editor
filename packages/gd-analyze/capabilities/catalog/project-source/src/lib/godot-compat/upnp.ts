export const GODOT_UPNP_RESULT_SUCCESS = 0;
export const GODOT_UPNP_RESULT_INVALID_GATEWAY = 18;
export const GODOT_UPNP_RESULT_INVALID_PORT = 19;
export const GODOT_UPNP_RESULT_INVALID_PROTOCOL = 20;
export const GODOT_UPNP_RESULT_INVALID_DURATION = 21;
export const GODOT_UPNP_RESULT_INVALID_ARGS = 22;
export const GODOT_UPNP_RESULT_NO_GATEWAY = 28;
export const GODOT_UPNP_RESULT_NO_DEVICES = 29;
export const GODOT_UPNP_RESULT_UNKNOWN_ERROR = 30;

export const GODOT_UPNP_IGD_STATUS_OK = 0;
export const GODOT_UPNP_IGD_STATUS_HTTP_ERROR = 1;
export const GODOT_UPNP_IGD_STATUS_HTTP_EMPTY = 2;
export const GODOT_UPNP_IGD_STATUS_NO_URLS = 3;
export const GODOT_UPNP_IGD_STATUS_NO_IGD = 4;
export const GODOT_UPNP_IGD_STATUS_DISCONNECTED = 5;
export const GODOT_UPNP_IGD_STATUS_UNKNOWN_DEVICE = 6;
export const GODOT_UPNP_IGD_STATUS_INVALID_CONTROL = 7;
export const GODOT_UPNP_IGD_STATUS_MALLOC_ERROR = 8;
export const GODOT_UPNP_IGD_STATUS_UNKNOWN_ERROR = 9;

export interface GodotUPNPPortMapping {
  port: number;
  portInternal: number;
  description: string;
  protocol: 'TCP' | 'UDP';
  duration: number;
}

export interface GodotUPNPDeviceCarrier {
  queryExternalAddress?(device: GodotUPNPDevice): string;
  addPortMapping?(device: GodotUPNPDevice, mapping: GodotUPNPPortMapping): number;
  deletePortMapping?(device: GodotUPNPDevice, port: number, protocol: string): number;
}

function port(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65535 ? value : -1;
}

function protocol(value: string): 'TCP' | 'UDP' | null {
  const normalized = value.toUpperCase();
  return normalized === 'TCP' || normalized === 'UDP' ? normalized : null;
}

export class GodotUPNPDevice {
  private descriptionUrl = '';
  private serviceType = '';
  private igdControlUrl = '';
  private igdServiceType = '';
  private igdOurAddr = '';
  private igdStatus = GODOT_UPNP_IGD_STATUS_UNKNOWN_DEVICE;
  private externalAddress = '';
  private readonly mappings = new Map<string, GodotUPNPPortMapping>();

  constructor(private readonly carrier: GodotUPNPDeviceCarrier = {}) {}

  is_valid_gateway(): boolean {
    return this.igdStatus === GODOT_UPNP_IGD_STATUS_OK && this.igdControlUrl !== '';
  }

  query_external_address(): string {
    return this.carrier.queryExternalAddress?.(this) ?? this.externalAddress;
  }

  add_port_mapping(portValue: number, portInternal = 0, desc = '', proto = 'UDP', duration = 0): number {
    const external = port(portValue);
    const internal = port(portInternal === 0 ? portValue : portInternal);
    const normalizedProtocol = protocol(proto);
    if (!this.is_valid_gateway()) return GODOT_UPNP_RESULT_INVALID_GATEWAY;
    if (external < 0 || internal < 0) return GODOT_UPNP_RESULT_INVALID_PORT;
    if (normalizedProtocol === null) return GODOT_UPNP_RESULT_INVALID_PROTOCOL;
    if (!Number.isSafeInteger(duration) || duration < 0) return GODOT_UPNP_RESULT_INVALID_DURATION;
    const mapping = { port: external, portInternal: internal, description: desc, protocol: normalizedProtocol, duration };
    const result = this.carrier.addPortMapping?.(this, mapping) ?? GODOT_UPNP_RESULT_SUCCESS;
    if (result === GODOT_UPNP_RESULT_SUCCESS) this.mappings.set(`${normalizedProtocol}:${external}`, mapping);
    return result;
  }

  delete_port_mapping(portValue: number, proto = 'UDP'): number {
    const external = port(portValue);
    const normalizedProtocol = protocol(proto);
    if (!this.is_valid_gateway()) return GODOT_UPNP_RESULT_INVALID_GATEWAY;
    if (external < 0) return GODOT_UPNP_RESULT_INVALID_PORT;
    if (normalizedProtocol === null) return GODOT_UPNP_RESULT_INVALID_PROTOCOL;
    const result = this.carrier.deletePortMapping?.(this, external, normalizedProtocol) ?? GODOT_UPNP_RESULT_SUCCESS;
    if (result === GODOT_UPNP_RESULT_SUCCESS) this.mappings.delete(`${normalizedProtocol}:${external}`);
    return result;
  }

  set_description_url(url: string): void { this.descriptionUrl = url; }
  get_description_url(): string { return this.descriptionUrl; }
  set_service_type(type: string): void { this.serviceType = type; }
  get_service_type(): string { return this.serviceType; }
  set_igd_control_url(url: string): void { this.igdControlUrl = url; }
  get_igd_control_url(): string { return this.igdControlUrl; }
  set_igd_service_type(type: string): void { this.igdServiceType = type; }
  get_igd_service_type(): string { return this.igdServiceType; }
  set_igd_our_addr(addr: string): void { this.igdOurAddr = addr; }
  get_igd_our_addr(): string { return this.igdOurAddr; }
  set_igd_status(status: number): void { this.igdStatus = status; }
  get_igd_status(): number { return this.igdStatus; }
  set_external_address(address: string): void { this.externalAddress = address; }
  get_port_mappings(): readonly GodotUPNPPortMapping[] { return [...this.mappings.values()]; }
}

export interface GodotUPNPDiscoveryCarrier {
  discover?(timeout: number, ttl: number, deviceFilter: string, multicastInterface: string, localPort: number, ipv6: boolean): readonly GodotUPNPDevice[];
}

export class GodotUPNP {
  private readonly devices: GodotUPNPDevice[] = [];
  private discoverMulticastInterface = '';
  private discoverLocalPort = 0;
  private discoverIPv6 = false;

  constructor(private readonly discovery: GodotUPNPDiscoveryCarrier = {}) {}

  get_device_count(): number { return this.devices.length; }
  get_device(index: number): GodotUPNPDevice | null { return this.devices[index] ?? null; }

  add_device(device: GodotUPNPDevice): void {
    if (!this.devices.includes(device)) this.devices.push(device);
  }

  set_device(index: number, device: GodotUPNPDevice): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.devices.length) throw new RangeError('UPNP device index is out of range.');
    this.devices[index] = device;
  }

  remove_device(index: number): void {
    if (Number.isSafeInteger(index) && index >= 0 && index < this.devices.length) this.devices.splice(index, 1);
  }

  clear_devices(): void { this.devices.length = 0; }
  get_gateway(): GodotUPNPDevice | null { return this.devices.find((device) => device.is_valid_gateway()) ?? null; }

  discover(timeout = 2000, ttl = 2, deviceFilter = 'InternetGatewayDevice'): number {
    const found = this.discovery.discover?.(timeout, ttl, deviceFilter, this.discoverMulticastInterface, this.discoverLocalPort, this.discoverIPv6) ?? [];
    this.devices.splice(0, this.devices.length, ...found);
    return this.devices.length > 0 ? GODOT_UPNP_RESULT_SUCCESS : GODOT_UPNP_RESULT_NO_DEVICES;
  }

  query_external_address(): string { return this.get_gateway()?.query_external_address() ?? ''; }

  add_port_mapping(portValue: number, portInternal = 0, desc = '', proto = 'UDP', duration = 0): number {
    return this.get_gateway()?.add_port_mapping(portValue, portInternal, desc, proto, duration) ?? GODOT_UPNP_RESULT_NO_GATEWAY;
  }

  delete_port_mapping(portValue: number, proto = 'UDP'): number {
    return this.get_gateway()?.delete_port_mapping(portValue, proto) ?? GODOT_UPNP_RESULT_NO_GATEWAY;
  }

  set_discover_multicast_if(multicastInterface: string): void { this.discoverMulticastInterface = multicastInterface; }
  get_discover_multicast_if(): string { return this.discoverMulticastInterface; }
  set_discover_local_port(localPort: number): void { this.discoverLocalPort = localPort; }
  get_discover_local_port(): number { return this.discoverLocalPort; }
  set_discover_ipv6(ipv6: boolean): void { this.discoverIPv6 = ipv6; }
  is_discover_ipv6(): boolean { return this.discoverIPv6; }
}

export function createGodotUPNP(discovery: GodotUPNPDiscoveryCarrier = {}): GodotUPNP { return new GodotUPNP(discovery); }
export function createGodotUPNPDevice(carrier: GodotUPNPDeviceCarrier = {}): GodotUPNPDevice { return new GodotUPNPDevice(carrier); }
