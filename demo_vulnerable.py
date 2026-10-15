def calculate(value):
    try:
        result = eval(value)
        print(result)
        return result
    except Exception:
        pass
