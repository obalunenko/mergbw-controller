package managed

// NewBluetoothStatus separates observed connectivity from an evidenced reason.
// A disconnected link never implies permission denial or an unavailable adapter.
func NewBluetoothStatus(binding Binding, state string, category Code) BluetoothStatus {
	switch state {
	case "connected", "disconnected", "unknown":
	default:
		state = "unknown"
	}
	switch category {
	case "permission_denied", "bluetooth_unavailable", "backend_restart_required":
	default:
		category = ""
	}
	return BluetoothStatus{Binding: binding, Bluetooth: state, ErrorCategory: category}
}

// SafeCode accepts only private protocol categories, including before config
// loads. It never stringifies arbitrary filesystem, imported or native errors.
func SafeCode(err error) Code { return safeCode(err) }
