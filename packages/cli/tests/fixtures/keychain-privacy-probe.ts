import { clearKeychainSecret, getKeychainSecret, setKeychainSecret } from "../../src/data/keychain.ts";

Object.defineProperty(process, "platform", { value: process.env.SUNAT_TEST_KEYCHAIN_PLATFORM || "darwin" });
const action = process.env.SUNAT_TEST_KEYCHAIN_ACTION || "set";
if (action === "set") {
	setKeychainSecret("SUNAT_PASSWORD", process.env.SUNAT_TEST_KEYCHAIN_SECRET || "private-clave-sol");
} else if (action === "get") {
	getKeychainSecret("SUNAT_PASSWORD");
} else if (action === "clear") {
	clearKeychainSecret("SUNAT_PASSWORD");
} else {
	throw new Error(`Unknown keychain probe action: ${action}`);
}
