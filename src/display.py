import glob

import cv2

# Load all saved frames (sorted by filename)
frames = sorted(glob.glob("frame_*.png"))

# Create a named window and set it to full screen
cv2.namedWindow("Stop Motion", cv2.WND_PROP_FULLSCREEN)
cv2.setWindowProperty("Stop Motion", cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

for f in frames:
    img = cv2.imread(f)
    cv2.imshow("Stop Motion", img)

    # Wait 200 ms per frame (5 FPS feel)
    if cv2.waitKey(200) & 0xFF == ord("q"):
        break

cv2.destroyAllWindows()
