# Capture and local viewer workflow

The local viewer and JSON folder bridge work independently of packet capture. A packet capture is not a race export: encrypted packets do not become decoded race JSON merely by exporting them with Wireshark. No Steam Global race capture has been decoded by this project yet. The demo race is synthetic.

## Start the local viewer

From the repository directory:

```powershell
npm install
npm run build
npm run bridge
```

Open <http://127.0.0.1:4318>. The bridge creates `captures/inbox`. Use the viewer's folder connection control, then place a supported race JSON export in that folder. The viewer polls for changes; the bridge itself does not collect game traffic. For manual static-site use, open a JSON file with the viewer's file picker instead.

The bridge reads only regular `.json` files directly inside the inbox, with a 16 MiB limit. It selects the most recently modified parseable object/array, skips malformed or incomplete files, and exposes the result at `GET /api/races/latest`:

```json
{"filename":"race.json","receivedAt":"2026-10-14T00:00:00.000Z","sha256":"…","data":{}}
```

Before any usable file exists, all four fields are `null`. `receivedAt` is the file's modification time, not the race's start time. For an automated producer, write to `race.tmp` first and rename it to `race.json` after the file is complete. The bridge validates JSON syntax; race schema validation happens in the viewer. Remove unrelated JSON from the inbox.

The server binds only to `127.0.0.1`, permits the local bridge and Vite origins on ports 5173/4173, rejects foreign `Host` values, and has no HTTP upload or arbitrary filesystem-path endpoint. It serves a snapshot of `dist`; restart the bridge after rebuilding. GitHub Pages serves only the browser app: it does not run this Node server or capture traffic.

## Check capture tools

```powershell
node scripts/capture-preflight.mjs
```

This checks versions without starting a capture. It checks `E:\Program Files\Wireshark`, the usual Windows Program Files location, and `PATH`. Wireshark with TShark and Npcap provides packet inspection and capture on Windows. The local installation found during setup was Wireshark 3.4.0 in `E:\Program Files\Wireshark`; the commands below use that path. See the [official download page](https://www.wireshark.org/download.html).

## Scope one race capture

1. Start the game normally and identify the game's PID in Task Manager → Details. Do not select Steam, its browser processes, or the anti-cheat service.
2. In PowerShell, replace the PID below with the observed game PID. Inspect connections while opening the game's race screen:

   ```powershell
   $gameProcessId = 12345 # Replace with the actual PID, not this example.
   Get-NetTCPConnection -OwningProcess $gameProcessId |
     Where-Object State -eq Established |
     Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort
   ```

   `Get-NetTCPConnection` exposes the owning process and connection endpoints. If Windows denies access, run this read-only lookup in an elevated PowerShell. Record the endpoints and the time; a PID alone is not a Wireshark capture filter. [Microsoft command reference](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection)

3. List interfaces with `& 'E:\Program Files\Wireshark\dumpcap.exe' -D`. Choose the active Ethernet/Wi-Fi interface matching the connection's local address. Do not guess an interface number: the number can change.
4. In Wireshark's Capture Options, set a capture filter for the **observed** remote game endpoint, such as `host 203.0.113.10 and tcp port 443` (documentation address; replace it). Several observed endpoints can be joined with `or`. A remote IP may be shared by several services, so this is a scoped capture, not proof that every packet belongs to the game.
5. Start capture just before entering one race, note the wall-clock start/end times, and stop after results appear. Save under `captures/raw`, outside the inbox. Capture the connection handshake if possible; a connection opened before capture can omit the TLS ClientHello.

Equivalent command after choosing the real interface and filter:

```powershell
New-Item -ItemType Directory -Force .\captures\raw | Out-Null
& 'E:\Program Files\Wireshark\dumpcap.exe' -i 6 -p -f 'host 203.0.113.10 and tcp port 443' -a duration:180 -a filesize:65536 -w .\captures\raw\race.pcapng
```

The example stops after 180 seconds or approximately 64 MB. `-p` avoids enabling promiscuous mode; `-f` is the capture filter. Substitute both example interface and IP before running. [Dumpcap reference](https://www.wireshark.org/docs/man-pages/dumpcap.html)

Captures can contain account identifiers, authentication material, and unrelated traffic. Keep raw captures local. Only share an inspected race export after removing account/session fields. This workflow does not install a game plugin, change trust certificates, proxy requests, attach to the game, or change anti-cheat settings. It cannot guarantee a particular game's anti-cheat or terms-of-service treatment of external capture software.

## Inspect an existing capture offline

```powershell
node scripts/inspect-capture.mjs .\captures\raw\race.pcapng
```

This creates a new analysis directory beside the capture containing protocol/conversation statistics, TLS ClientHello metadata, and HTTP response metadata. It disables name resolution and excludes packet bodies. The report is **not** a race export and does not belong in `captures/inbox`. The script has no live-capture option.

To inspect TLS handshakes directly:

```powershell
& 'E:\Program Files\Wireshark\tshark.exe' -n -r .\captures\raw\race.pcapng -Y 'tls.handshake.type == 1' -T fields -E header=y -E separator=, -E quote=d -e frame.number -e frame.time_relative -e ip.dst -e ipv6.dst -e tcp.stream -e tls.handshake.extensions_server_name
```

An empty result does not prove the game uses no TLS: the connection could predate the capture, use a different transport, or hide the server name. A host name and packet sizes can locate a conversation, but cannot reveal race positions. See the [TShark reference](https://www.wireshark.org/docs/man-pages/tshark.html) and [TLS field reference](https://www.wireshark.org/docs/dfref/t/tls.html).

If Wireshark shows TLS Application Data, it needs appropriate session secrets to decrypt it. Setting `SSLKEYLOGFILE` is useful only for clients/libraries that actually support key logging; this project has not established support in Steam Global. Passive capture alone is not a TLS decryption method. See [Wireshark's TLS documentation](https://wiki.wireshark.org/TLS).

## Export only after a readable response exists

If the capture already contains a reassembled, readable HTTP response, use Wireshark **File → Export Objects → HTTP**, select that specific response, and save it to a separate inspection folder. This exports the HTTP object rather than Wireshark's packet-dissection JSON. [Export Objects documentation](https://www.wireshark.org/docs/wsug_html_chunked/ChIOExportSection.html)

Verify the object is actually decoded JSON and contains race information. An HTTP body may still be encrypted, compressed, or binary MessagePack; renaming it `.json` does not decode it. Do not put a raw `.pcapng`, packet-dissection JSON, credentials, or a whole account response in the bridge inbox. Only a supported race object can be visualized. If the response remains opaque, record that finding and stop at metadata; a working no-plugin extraction path is still an open research question.

## Optional built-in Windows capture

`pktmon` can record packets without installing Wireshark's capture driver. Use it only when needed: it requires elevation and has system-wide filter state. Inspect `pktmon status` and `pktmon filter list` first. Do not start it while another capture session is active, and do not remove someone else's filters. Existing filters are alternatives, so they can broaden capture beyond the new filter.

With no existing filters/session and an observed endpoint, the manual sequence is:

```powershell
pktmon filter add UmaRace -i 203.0.113.10 -t TCP -p 443
pktmon start --capture --comp nics --pkt-size 0 --file-name .\captures\raw\race.etl --file-size 64 --log-mode circular
# Play one race, then stop promptly.
pktmon stop
pktmon etl2pcap .\captures\raw\race.etl --out .\captures\raw\race.pcapng
pktmon filter list
# Only if the list still contains solely the UmaRace filter you added:
pktmon filter remove
```

Replace the example IP and port first, and create `captures/raw` beforehand. `--pkt-size 0` retains full packets. The circular log limits disk use but does not stop capture automatically; always run `pktmon stop` after the race. On this Windows installation, `pktmon filter remove` removes **all** filters; leave filters untouched if anyone else has added one. Analysis still needs a packet reader such as Wireshark/TShark. See Microsoft's [filter](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-filter-add), [capture](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-start), and [conversion](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-etl2pcap) references.
