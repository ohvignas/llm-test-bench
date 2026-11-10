def post_worker_init(worker):
    from .operator_socket import start_operator
    worker.bench_operator = start_operator(worker.wsgi)
