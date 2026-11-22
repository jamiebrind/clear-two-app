export const inputLabels = {
  wifi: 'Wi-Fi / Network', aux: 'Aux (Line In)', bluetooth: 'Bluetooth',
  'usb-drive': 'USB Drive', 'usb-dac': 'USB DAC (Computer)', optical: 'Optical',
  coaxial: 'Coaxial', 'aux-2': 'Aux 2',
} as const;

export type InputId = keyof typeof inputLabels;
