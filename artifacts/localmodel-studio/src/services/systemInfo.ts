export function getSystemInfo() {
  const userAgent = navigator.userAgent;
  let os = "Unknown";
  if (userAgent.indexOf("Win") !== -1) os = "Windows";
  if (userAgent.indexOf("Mac") !== -1) os = "MacOS";
  if (userAgent.indexOf("X11") !== -1) os = "UNIX";
  if (userAgent.indexOf("Linux") !== -1) os = "Linux";

  const cpuCores = navigator.hardwareConcurrency || "Unknown";
  // @ts-ignore
  const ram = navigator.deviceMemory || null;

  return {
    os,
    cpuCores,
    ram,
    userAgent,
    hardwareConcurrency: cpuCores
  };
}
