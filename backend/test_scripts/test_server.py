import socket

# This is the standard Steam/Epic "A2S_INFO" handshake packet
QUERY_PACKET = b'\xFF\xFF\xFF\xFFTSource Engine Query\x00'
SERVER_IP = "100.81.109.24"  # <--- Change this to your Server's Tailscale IP
QUERY_PORT = 7778

print(f"Pinging {SERVER_IP}:{QUERY_PORT}...")

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(3.0)  # Wait 3 seconds before giving up

try:
    # Send the knock
    sock.sendto(QUERY_PACKET, (SERVER_IP, QUERY_PORT))

    # Listen for the response
    data, addr = sock.recvfrom(1024)
    print("\n[SUCCESS!] The server is ALIVE and replied.")
    print("Raw Server Data:", data[:50])

except socket.timeout:
    print("\n[FAILED] The connection timed out. The port is blocked or Docker is dropping it.")