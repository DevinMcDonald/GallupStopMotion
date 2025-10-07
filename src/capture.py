import cv2

cap = cv2.VideoCapture(0)
frame_count = 0

print("Press Enter to capture an image, or 'q' then Enter to quit.")

while True:
    cmd = input()
    if cmd.lower() == "q":
        break

    ret, frame = cap.read()
    if ret:
        filename = f"frame_{frame_count:03d}.png"
        cv2.imwrite(filename, frame)
        print(f"Saved {filename}")
        frame_count += 1

cap.release()
