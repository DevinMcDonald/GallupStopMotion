from buttonMonitor import SerialMonitor


def main():
    serialMonitor = SerialMonitor()
    for button in serialMonitor.inputs:
        print(f"received button: {button}")


if __name__ == "__main__":
    main()
