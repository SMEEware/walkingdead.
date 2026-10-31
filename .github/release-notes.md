Self-hosted multi-protocol honeypot with an emulated shell, MITRE ATT&CK classification,
attacker profiles, firewall-ready blocklists, webhook alerts, a monitor API with a live
attack stream and the Feral Walker sentinel.

### Install

Download the archive for your platform, verify it and start it:

```sh
tar xzf walkingdead-<version>-linux_amd64.tar.gz
cd linux_amd64
sha256sum -c SHA256SUMS          # macOS: shasum -a 256 -c SHA256SUMS
./start.sh --username owner
```

On Windows, unpack the `.zip` and run `.\start.bat --username owner` from PowerShell or `cmd`.

Open http://127.0.0.1:8080, enable decoys under Settings → Decoys and press Start system.
The API reference is served at `/docs`. Each archive contains `wdd` (service with embedded
console), `wd` (CLI), `start.sh` (Windows: `start.bat` and `start.ps1`), `openapi.json`, the README and license notices.
`SHA256SUMS.txt` lists the archive checksums.

See the [README](https://github.com/SMEEware/walkingdead.#readme) for configuration,
exposing decoys, the API and the CLI.
